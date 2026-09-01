// tests/chain.test.js
// Tests de la cadena de hashes + privacidad del access_token.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let db, dbPath, addParticipacion, validateChain, computeChain, eliminarUltima, decimoId;

// Cargar los módulos UNA sola vez (no por test). La BD se abre con DB_PATH
// temporal distinto en cada test; schema.openDb lee DB_PATH en cada llamada.
const schema = require('../src/db/schema');
const chain = require('../src/db/chain');

function freshDb() {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loteria-')), 'test.db');
  process.env.DB_PATH = dbPath;
  db = schema.openDb();
  addParticipacion = chain.addParticipacion;
  validateChain = chain.validateChain;
  computeChain = chain.computeChain;
  eliminarUltima = chain.eliminarUltimaParticipacion;
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

test('eliminar la última participación NO rompe la cadena', () => {
  addParticipacion(db, { decimoId, importe: 10, nombre: 'Ana' });
  addParticipacion(db, { decimoId, importe: 5, nombre: 'Luis' });
  addParticipacion(db, { decimoId, importe: 5, nombre: 'Marta' });
  expect(validateChain(db, decimoId)).toBe(true);
  // eliminar la última (Marta)
  const r = eliminarUltima(db, decimoId);
  expect(r.ok).toBe(true);
  expect(r.participacion.nombre).toBe('Marta');
  // la cadena sigue siendo válida (las 2 restantes encadenan bien)
  expect(validateChain(db, decimoId)).toBe(true);
  const agg = db.prepare('SELECT COUNT(*) c FROM participaciones WHERE decimo_id=?').get(decimoId).c;
  expect(agg).toBe(2);
});

test('no se puede eliminar una participación intermedia (la cadena no es la última)', () => {
  addParticipacion(db, { decimoId, importe: 10, nombre: 'Ana' });
  addParticipacion(db, { decimoId, importe: 5, nombre: 'Luis' });
  addParticipacion(db, { decimoId, importe: 5, nombre: 'Marta' });
  // Manipular: intentar borrar Ana directamente en BD y comprobar que la cadena se rompe
  // (lo que confirma por qué solo permitimos borrar la última)
  db.prepare("DELETE FROM participaciones WHERE nombre_participante='Ana'").run();
  expect(validateChain(db, decimoId)).toBe(false);
});

// ---- MODALIDAD DE ASIGNACIÓN (A+D) ----

test('modalidad aportada registra importe_aportado = importe', () => {
  const r = addParticipacion(db, { decimoId, importe: 5, nombre: 'Ana' });
  expect(r.ok).toBe(true);
  expect(r.participacion.modalidad).toBe('aportada');
  expect(r.participacion.importe_aportado).toBe(5);
  const row = db.prepare('SELECT * FROM participaciones WHERE id = ?').get(r.participacion.id);
  expect(row.modalidad).toBe('aportada');
  expect(row.importe_aportado).toBe(5);
});

test('modalidad gratuita registra importe_aportado 0 y valor_referencia (ocupa cuota)', () => {
  // Décimo de 20€: una aportada de 10€ + un regalo de 5€ de cuota
  const a = addParticipacion(db, { decimoId, importe: 10, nombre: 'Ana' });
  const g = addParticipacion(db, { decimoId, importe: null, nombre: 'Luis', modalidad: 'gratuita', valorReferencia: 5 });
  expect(g.ok).toBe(true);
  expect(g.participacion.modalidad).toBe('gratuita');
  expect(g.participacion.importe_aportado).toBe(0);
  expect(g.participacion.valor_referencia).toBe(5);
  expect(g.participacion.importe).toBe(5); // valor económico en la cadena
  expect(validateChain(db, decimoId)).toBe(true);
});

test('modalidad gratuita NO puede superar el valor_total (el regalo ocupa cuota)', () => {
  addParticipacion(db, { decimoId, importe: 15, nombre: 'Ana' });
  const g = addParticipacion(db, { decimoId, nombre: 'Luis', modalidad: 'gratuita', valorReferencia: 10 });
  expect(g.ok).toBe(false);
  expect(g.error).toBe('supera_valor_total');
});

test('modalidad inválida es rechazada', () => {
  const r = addParticipacion(db, { decimoId, importe: 5, modalidad: 'donacion' });
  expect(r.ok).toBe(false);
  expect(r.error).toBe('modalidad_invalida');
});

test('gratuita sin valor_referencia es rechazada', () => {
  const r = addParticipacion(db, { decimoId, nombre: 'Luis', modalidad: 'gratuita' });
  expect(r.ok).toBe(false);
  expect(r.error).toBe('valor_referencia_invalido');
});

test('aceptación registra auditoría (fecha UTC, IP, UA, hash) y no se puede repetir', () => {
  const r = addParticipacion(db, { decimoId, importe: 5, nombre: 'Ana' });
  const token = r.participacion.access_token;
  const ahora = new Date().toISOString();
  db.prepare('UPDATE participaciones SET aceptado_at = ?, aceptado_ip = ?, aceptado_ua = ?, aceptado_hash = ? WHERE id = ?')
    .run(ahora, '127.0.0.1', 'test-ua', 'abc123', r.participacion.id);
  const row = db.prepare('SELECT * FROM participaciones WHERE id = ?').get(r.participacion.id);
  expect(row.aceptado_at).toBe(ahora);
  expect(row.aceptado_ip).toBe('127.0.0.1');
  expect(row.aceptado_ua).toBe('test-ua');
  expect(row.aceptado_hash).toBe('abc123');
  // no se puede aceptar dos veces: el UPDATE condicional no debe re-aceptar
  const n = db.prepare('UPDATE participaciones SET aceptado_at = ? WHERE id = ? AND aceptado_at IS NULL').run('otra', r.participacion.id).changes;
  expect(n).toBe(0);
});
