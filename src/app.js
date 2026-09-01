// src/app.js
// App Express — fase 2: imagen + PDF + verificación pública + OG dinámico.
const express = require('express');
const { openDb } = require('./db/schema');
const { addParticipacion, computeChain, eliminarUltimaParticipacion } = require('./db/chain');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Assets estáticos (favicon, og:image) — servir desde /assets
const path = require('path');
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

const db = openDb();

// Página de visualización + API
const viewRouter = require('./routes/view');
const verificarRouter = require('./routes/verificar');
app.use('/', viewRouter);
app.use('/verificar', verificarRouter);

// Crear un décimo se maneja en routes/view.js (POST /decimos -> redirect al panel)
// Este endpoint POST duplicado se elimina para evitar conflicto de rutas.

// Añadir participación (con validación de cadena y de valor_total)
app.post('/decimos/:id/participaciones', async (req, res) => {
  const { importe, nombre, modalidad = 'aportada', valorReferencia } = req.body || {};
  const r = addParticipacion(db, { decimoId: req.params.id, importe, nombre, modalidad, valorReferencia });
  if (!r.ok) return res.status(r.error === 'supera_valor_total' ? 409 : 400).json({ error: r.error, message: r.message });
  // generar imagen + PDF de la participación
  const decimo = db.prepare('SELECT * FROM decimos WHERE id = ?').get(req.params.id);
  const base = `${req.protocol}://${req.get('host')}`;
  const p = r.participacion;
  let imagen, pdf;
  try {
    const { generarImagen } = require('./lib/imagen');
    imagen = await generarImagen({
      participacionId: p.id, numero: decimo.numero, serie: decimo.serie,
      sorteo: decimo.sorteo, importe: p.importe, nombre, decimoId: decimo.id, baseUrl: base,
      accessToken: p.access_token, modalidad: p.modalidad, importeAportado: p.importe_aportado,
    });
  } catch (e) { console.error('imagen err:', e.message); }
  try {
    const { generarPdf } = require('./lib/pdf');
    pdf = await generarPdf({
      participacionId: p.id, numero: decimo.numero, serie: decimo.serie,
      sorteo: decimo.sorteo, importe: p.importe, nombre, valorTotal: decimo.valor_total, decimoId: decimo.id,
      modalidad: p.modalidad,
    });
  } catch (e) { console.error('pdf err:', e.message); }
  // Responder SOLO el access_token (secreto del partícipe) + rutas de descarga.
  // NUNCA el participacion_id interno.
  res.status(201).json({
    ok: true,
    access_token: p.access_token,
    importe: p.importe,
    importe_aportado: p.importe_aportado,
    valor_referencia: p.valor_referencia,
    modalidad: p.modalidad,
    nombre: nombre || null,
    comprobante: `/mi-participacion/${p.access_token}`,
    imagen: imagen || null,
    pdf: pdf || null,
  });
});

// Aceptación electrónica del partícipe (nivel 1: enlace privado + auditoría).
// Registra fecha UTC, IP, user-agent y hash del documento aceptado. NO es una
// firma electrónica cualificada: es constancia de lectura y aceptación.
app.post('/mi-participacion/:token/aceptar', (req, res) => {
  const token = req.params.token || '';
  const p = db.prepare('SELECT * FROM participaciones WHERE access_token = ?').get(token);
  if (!p) return res.status(404).json({ error: 'no_encontrada' });
  if (p.aceptado_at) return res.status(409).json({ error: 'ya_aceptada', message: 'Esta participación ya ha sido aceptada.' });
  const decimo = db.prepare('SELECT * FROM decimos WHERE id = ?').get(p.decimo_id);
  if (!decimo || decimo.estado === 'cerrado') return res.status(409).json({ error: 'reparto_cerrado', message: 'El reparto está cerrado.' });

  const ip = req.ip || req.connection.remoteAddress || '?';
  const ua = (req.get('user-agent') || '').slice(0, 200);
  const ahora = new Date().toISOString();
  const docHash = crypto.createHash('sha256').update(`${p.id}|${p.importe}|${p.modalidad}|${p.access_token.slice(0, 8)}`).digest('hex');

  db.prepare('UPDATE participaciones SET aceptado_at = ?, aceptado_ip = ?, aceptado_ua = ?, aceptado_hash = ? WHERE id = ?')
    .run(ahora, ip, ua, docHash, p.id);

  // Regenerar el PDF con la aceptación registrada
  try {
    const { generarPdf } = require('./lib/pdf');
    generarPdf({
      participacionId: p.id, numero: decimo.numero, serie: decimo.serie,
      sorteo: decimo.sorteo, importe: p.importe, nombre: p.nombre_participante,
      valorTotal: decimo.valor_total, decimoId: decimo.id, modalidad: p.modalidad,
      aceptacion: { at: ahora, hash: docHash },
    }).catch((e) => console.error('pdf aceptacion err:', e.message));
  } catch (e) { console.error('pdf aceptacion err:', e.message); }

  res.json({ ok: true, aceptado_at: ahora });
});

// Validar que el organizador_token es correcto para el décimo.
function validarOrganizador(req, res) {
  const d = db.prepare('SELECT * FROM decimos WHERE id = ?').get(req.params.id);
  if (!d) return null;
  const tok = (req.get('x-organizador-token') || '').trim();
  if (!tok || d.organizador_token !== tok) {
    res.status(403).json({ error: 'no_autorizado', message: 'Token de gestión incorrecto.' });
    return null;
  }
  return d;
}

// Eliminar la ÚLTIMA participación de un sorteo (corregir error del organizador).
// Solo el organizador (token) puede eliminarla. No rompe los hashes.
app.delete('/decimos/:id/participaciones/ultima', (req, res) => {
  const d = validarOrganizador(req, res);
  if (!d) return;
  const r = eliminarUltimaParticipacion(db, req.params.id);
  if (!r.ok) return res.status(400).json({ error: r.error, message: r.error });
  // borrar imagen y PDF generados de esa participación
  const fs = require('fs');
  const path = require('path');
  const base = path.join(__dirname, '..', 'output-samples');
  for (const ext of ['png', 'pdf']) {
    const f = path.join(base, ext === 'png' ? 'imagenes' : 'pdfs', `${r.participacion.id}.${ext}`);
    try { fs.unlinkSync(f); } catch (e) { /* no existe */ }
  }
  res.json({ ok: true, eliminada: r.participacion });
});

// Abrir / cerrar un reparto (solo el organizador con token)
app.post('/decimos/:id/cerrar', (req, res) => {
  const d = validarOrganizador(req, res);
  if (!d) return;
  db.prepare('UPDATE decimos SET estado = ? WHERE id = ?').run('cerrado', req.params.id);
  res.json({ ok: true, estado: 'cerrado' });
});
app.post('/decimos/:id/abrir', (req, res) => {
  const d = validarOrganizador(req, res);
  if (!d) return;
  db.prepare('UPDATE decimos SET estado = ? WHERE id = ?').run('abierto', req.params.id);
  res.json({ ok: true, estado: 'abierto' });
});

// Verificar integridad
app.get('/decimos/:id/verificar-api', (req, res) => {
  const decimo = db.prepare('SELECT * FROM decimos WHERE id = ?').get(req.params.id);
  if (!decimo) return res.status(404).json({ error: 'decimo_no_existe' });
  const { ok, participaciones, n } = computeChain(db, req.params.id);
  res.json({ ok, integro: ok, n, participaciones });
});

// Política de retención: anonimiza repartos vencidos (ejecutar por cron).
// Protegido por ADMIN_TOKEN para que no sea invocable públicamente.
app.post('/admin/retencion', (req, res) => {
  const tok = (req.get('x-admin-token') || '').trim();
  if (!process.env.ADMIN_TOKEN || tok !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'no_autorizado' });
  }
  const { aplicarRetencion } = require('./lib/retencion');
  const r = aplicarRetencion(db);
  res.json({ ok: true, ...r, retencion_meses: require('./lib/retencion').RETENCION_MESES });
});

// Solo arranca si se ejecuta directamente
if (require.main === module) {
  const PORT = process.env.PORT || 3005;
  app.listen(PORT, () => console.log(`Lotería hash-chain en http://localhost:${PORT}`));
}

module.exports = app;
