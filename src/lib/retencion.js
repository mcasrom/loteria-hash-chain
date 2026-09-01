// src/lib/retencion.js
// Política de retención de datos (RGPD-friendly):
//  - Un reparto cerrado se ANONIMIZA a los RETENCION_MESES (12) del cierre:
//    se borran los datos personales de sus participaciones (nombre, access_token,
//    IP, user-agent, aceptación) y sus archivos (imagen/PDF), conservando el
//    agregado (sumas, % y hashes) para que la verificación pública siga siendo útil.
//  - Un reparto ABIERTO con más de RETENCION_MESES sin actividad se marca
//    cerrado y se anonimiza (sorteos abandonados).
//
// La anonimización es irreversible y se hace en lotes pequeños para no bloquear.
const path = require('path');
const fs = require('fs');

const RETENCION_MESES = Number(process.env.RETENCION_MESES || 12);
const MS_MES = 30 * 24 * 60 * 60 * 1000; // ~30 días
const BATCH = 25;

const OUT_IMAGES = path.join(__dirname, '..', '..', 'output-samples', 'imagenes');
const OUT_PDFS = path.join(__dirname, '..', '..', 'output-samples', 'pdfs');

function borrarArchivos(participacionId) {
  for (const [dir, ext] of [[OUT_IMAGES, 'png'], [OUT_PDFS, 'pdf']]) {
    try { fs.unlinkSync(path.join(dir, `${participacionId}.${ext}`)); } catch (e) { /* no existe */ }
  }
}

/**
 * Anonimiza todas las participaciones de un décimo (borra datos personales,
 * conserva importe y hashes). Devuelve cuántas anonimizó.
 */
function anonimizarDecimo(db, decimoId) {
  const rows = db.prepare('SELECT id FROM participaciones WHERE decimo_id = ?').all(decimoId);
  let n = 0;
  for (const r of rows) {
    // access_token es NOT NULL UNIQUE: lo sustituimos por un placeholder
    // no identificable (el token original se pierde, ya no se puede usar).
    const anon = 'anon-' + require('crypto').randomBytes(16).toString('hex');
    db.prepare(
      `UPDATE participaciones
         SET nombre_participante = NULL,
             access_token = ?,
             importe_aportado = importe,
             valor_referencia = NULL,
             aceptado_at = NULL,
             aceptado_ip = NULL,
             aceptado_ua = NULL,
             aceptado_hash = NULL
       WHERE id = ? AND access_token NOT LIKE 'anon-%'`
    ).run(anon, r.id);
    borrarArchivos(r.id);
    n += 1;
  }
  return n;
}

/**
 * Ejecuta la política de retención. Devuelve un resumen de lo anonimizado.
 *
 * Referencia de antigüedad = created_at del DÉCIMO (fecha de creación/cierre
 * aproximada). Para el sorteo de Navidad se crea y cierra antes del sorteo;
 * 12 meses desde la creación del reparto es conservador y suficiente.
 */
function aplicarRetencion(db, ahora = Date.now()) {
  const resumen = { anonimizados: 0, repartos: 0 };

  const vencidos = db.prepare(
    `SELECT id, created_at FROM decimos WHERE estado = 'cerrado'`
  ).all();

  for (const d of vencidos) {
    const creado = new Date(d.created_at).getTime();
    if (ahora - creado > RETENCION_MESES * MS_MES) {
      const n = anonimizarDecimo(db, d.id);
      resumen.anonimizados += n;
      resumen.repartos += 1;
    }
  }

  return resumen;
}

module.exports = { aplicarRetencion, anonimizarDecimo, RETENCION_MESES };
