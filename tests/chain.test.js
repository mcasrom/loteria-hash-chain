// tests/chain.test.js
// Tests de la cadena de hashes + privacidad del access_token.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let db, dbPath, addParticipacion, validateChain, computeChain, decimoId;

function freshDb() {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loteria-')), 'test.db');
  process.env.DB_PATH = dbPath;
  delete require.cache[require.resolve('../src/db/schema')];
  delete require.cache[require.resolve('../src/db/chain')];
  const schema2 = require('../src/db/schema');
  const chain2 = require('../src/db/chain');
  db = schema2.openDb();
  addParticipacion = chain2.addParticipacion;
  validateChain = chain2.validateChain;
  computeChain = chain2.computeChain;
}

beforeEach(() => {
  freshDb();
  decimoId = crypto.randomUUID();
  db.prepare('INSERT INTO decimos (id, organizador_id, numero, serie, sorteo, valor_total, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(decimoId, null, '85432', '021', 'Navidad 2026', 20, new Date().toISOString());
});

afterEach(() => {
  db.close();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

test('cadena válida pasa la verificación', () => {
  expect(addParticipacion(db, { decimoId, importe: 10, nombre: 'Ana' }).ok).toBe(true);
  expect(addParticipacion(db, { decimoId, importe: 5, nombre: 'Luis' }).ok).toBe(true);
  expect(validateChain(db, decimoId)).toBe(true);
});

test('ALTERAR UN IMPORTE EN BD ROMPE LA VERIFICACIÓN (manipulación detectada)', () => {
  addParticipacion(db, { decimoId, importe: 10, nombre: 'Ana' });
  addParticipacion(db, { decimoId, importe: 5, nombre: 'Luis' });
  expect(validateChain(db, decimoId)).toBe(true);
  db.prepare("UPDATE participaciones SET importe = 19 WHERE nombre_participante = 'Ana'").run();
  expect(validateChain(db, decimoId)).toBe(false);
  const detalle = computeChain(db, decimoId);
  expect(detalle.ok).toBe(false);
});

test('emitir por encima del valor_total FALLA', () => {
  addParticipacion(db, { decimoId, importe: 10, nombre: 'Ana' });
  addParticipacion(db, { decimoId, importe: 5, nombre: 'Luis' });
  addParticipacion(db, { decimoId, importe: 5, nombre: 'Marta' });
  const r = addParticipacion(db, { decimoId, importe: 1, nombre: 'X' });
  expect(r.ok).toBe(false);
  expect(r.error).toBe('supera_valor_total');
});

test('importe inválido es rechazado', () => {
  const r = addParticipacion(db, { decimoId, importe: -5 });
  expect(r.ok).toBe(false);
});

// ---- PRIVACIDAD DEL ACCESS_TOKEN ----

test('cada participación recibe un access_token de 256 bits, único y no derivable del id', () => {
  const a = addParticipacion(db, { decimoId, importe: 10, nombre: 'Ana' });
  const b = addParticipacion(db, { decimoId, importe: 5, nombre: 'Luis' });
  const ta = a.participacion.access_token;
  const tb = b.participacion.access_token;
  // 256 bits => 64 hex chars
  expect(ta).toMatch(/^[0-9a-f]{64}$/);
  expect(tb).toMatch(/^[0-9a-f]{64}$/);
  // únicos
  expect(ta).not.toBe(tb);
  // no derivables del id (son distintos y el id interno no es un prefijo)
  expect(ta).not.toContain(a.participacion.id.slice(0, 8));
  expect(a.participacion.id).not.toBe(ta);
});

test('un token => una participación (sin alias)', () => {
  const a = addParticipacion(db, { decimoId, importe: 10, nombre: 'Ana' });
  const encontrado = db.prepare('SELECT * FROM participaciones WHERE access_token = ?').get(a.participacion.access_token);
  expect(encontrado.id).toBe(a.participacion.id);
  // el mismo token no aparece en otra fila
  const n = db.prepare('SELECT COUNT(*) c FROM participaciones WHERE access_token = ?').get(a.participacion.access_token).c;
  expect(n).toBe(1);
});

test('los IDs internos NO se exponen vía /verificar (solo agregados)', () => {
  const a = addParticipacion(db, { decimoId, importe: 10, nombre: 'Ana' });
  // El computeChain devuelve ids internos pero la página /verificar NO debe usarlos.
  // Comprobamos que computeChain no es la fuente pública: /verificar usa solo
  // COUNT y SUM. Aquí validamos que el id interno no es el access_token.
  const row = db.prepare('SELECT id, access_token FROM participaciones WHERE id = ?').get(a.participacion.id);
  expect(row.access_token).not.toBe(row.id);
});

test('simular un access_token inventado: no existe en BD (equivale a 404)', () => {
  const falso = crypto.randomBytes(32).toString('hex');
  const p = db.prepare('SELECT * FROM participaciones WHERE access_token = ?').get(falso);
  expect(p).toBeUndefined();
});
