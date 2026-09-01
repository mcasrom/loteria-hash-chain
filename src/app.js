// src/app.js
// App Express — fase 2: imagen + PDF + verificación pública + OG dinámico.
const express = require('express');
const { openDb } = require('./db/schema');
const { addParticipacion, computeChain } = require('./db/chain');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const db = openDb();

// Página de visualización + API
const viewRouter = require('./routes/view');
const verificarRouter = require('./routes/verificar');
app.use('/', viewRouter);
app.use('/verificar', verificarRouter);

// Crear un décimo
app.post('/decimos', (req, res) => {
  const { numero, serie, sorteo, valor_total } = req.body || {};
  if (!numero || !sorteo || typeof valor_total !== 'number') {
    return res.status(400).json({ error: 'numero_sorteo_valor_requeridos' });
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO decimos (id, organizador_id, numero, serie, sorteo, valor_total, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, null, numero, serie || '', sorteo, valor_total, new Date().toISOString());
  res.json({ ok: true, id, numero, serie: serie || '', sorteo, valor_total });
});

// Añadir participación (con validación de cadena y de valor_total)
app.post('/decimos/:id/participaciones', async (req, res) => {
  const { importe, nombre } = req.body || {};
  const r = addParticipacion(db, { decimoId: req.params.id, importe, nombre });
  if (!r.ok) return res.status(r.error === 'supera_valor_total' ? 409 : 400).json({ error: r.error, message: r.message });
  // generar imagen + PDF de la participación
  const decimo = db.prepare('SELECT * FROM decimos WHERE id = ?').get(req.params.id);
  const base = `${req.protocol}://${req.get('host')}`;
  let imagen, pdf;
  try {
    const { generarImagen } = require('./lib/imagen');
    imagen = await generarImagen({
      participacionId: r.participacion.id, numero: decimo.numero, serie: decimo.serie,
      sorteo: decimo.sorteo, importe, nombre, decimoId: decimo.id, baseUrl: base,
    });
  } catch (e) { console.error('imagen err:', e.message); }
  try {
    const { generarPdf } = require('./lib/pdf');
    pdf = await generarPdf({
      participacionId: r.participacion.id, numero: decimo.numero, serie: decimo.serie,
      sorteo: decimo.sorteo, importe, nombre, valorTotal: decimo.valor_total, decimoId: decimo.id,
    });
  } catch (e) { console.error('pdf err:', e.message); }
  res.status(201).json({ ok: true, participacion: r.participacion, imagen, pdf });
});

// Verificar integridad
app.get('/decimos/:id/verificar-api', (req, res) => {
  const decimo = db.prepare('SELECT * FROM decimos WHERE id = ?').get(req.params.id);
  if (!decimo) return res.status(404).json({ error: 'decimo_no_existe' });
  const { ok, participaciones, n } = computeChain(db, req.params.id);
  res.json({ ok, integro: ok, n, participaciones });
});

// Solo arranca si se ejecuta directamente
if (require.main === module) {
  const PORT = process.env.PORT || 3005;
  app.listen(PORT, () => console.log(`Lotería hash-chain en http://localhost:${PORT}`));
}

module.exports = app;
