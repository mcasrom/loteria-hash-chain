// src/app.js
// App Express mínima (fase 1). Sin login, sin PDF, sin endpoint público de
// verificación todavía — eso es la fase 2.
const express = require('express');
const { openDb } = require('./db/schema');
const { addParticipacion, validateChain, computeChain } = require('./db/chain');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const db = openDb();

// Crear un décimo (helper para probar la cadena)
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
app.post('/decimos/:id/participaciones', (req, res) => {
  const { importe, nombre } = req.body || {};
  const r = addParticipacion(db, { decimoId: req.params.id, importe, nombre });
  if (!r.ok) return res.status(r.error === 'supera_valor_total' ? 409 : 400).json({ error: r.error, message: r.message });
  res.status(201).json({ ok: true, participacion: r.participacion });
});

// Verificar integridad de la cadena de un décimo
app.get('/decimos/:id/verificar', (req, res) => {
  const decimo = db.prepare('SELECT * FROM decimos WHERE id = ?').get(req.params.id);
  if (!decimo) return res.status(404).json({ error: 'decimo_no_existe' });
  const { ok, participaciones, n } = computeChain(db, req.params.id);
  res.json({ ok, integro: ok, n, participaciones });
});

// Solo arranca si se ejecuta directamente (evita que los tests abran el server)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Lotería hash-chain en http://localhost:${PORT}`));
}

module.exports = app;
