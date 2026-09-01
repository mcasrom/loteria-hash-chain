// tests/chain.test.js
// Tests de la cadena de hashes. El test crítico:
//   "alterar un importe en la BD rompe la verificación"
// demuestra que el sistema DETECTA manipulación.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Cargar módulos limpios por test (BD temporal)
let db, dbPath, addParticipacion, validateChain, computeChain, decimoId;

function freshDb() {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loteria-')), 'test.db');
  const { openDb } = require('../src/db/schema');
  const chain = require('../src/db/chain');
  process.env.DB_PATH = dbPath;
  // recargar schema/chain con la nueva DB_PATH (fuerza re-evaluación)
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
  expect(addParticipacion(db, { decimoId, importe: 5, nombre: 'Marta' }).ok).toBe(true);
  expect(validateChain(db, decimoId)).toBe(true);
});

test('ALTERAR UN IMPORTE EN BD ROMPE LA VERIFICACIÓN (manipulación detectada)', () => {
  addParticipacion(db, { decimoId, importe: 10, nombre: 'Ana' });
  addParticipacion(db, { decimoId, importe: 5, nombre: 'Luis' });

  // ANTES de alterar: íntegra
  expect(validateChain(db, decimoId)).toBe(true);

  // MANIPULACIÓN: cambiar el importe de una participación directamente en BD
  db.prepare("UPDATE participaciones SET importe = 19 WHERE nombre_participante = 'Ana'").run();

  // DESPUÉS: la cadena DEBE estar rota (este es el punto crítico de seguridad)
  expect(validateChain(db, decimoId)).toBe(false);

  // El detalle muestra cuál hash ya no coincide
  const detalle = computeChain(db, decimoId);
  expect(detalle.ok).toBe(false);
  expect(detalle.participaciones.some(p => !p.ok)).toBe(true);
});

test('emitir participaciones por encima del valor_total FALLA', () => {
  addParticipacion(db, { decimoId, importe: 10, nombre: 'Ana' });
  addParticipacion(db, { decimoId, importe: 5, nombre: 'Luis' });
  addParticipacion(db, { decimoId, importe: 5, nombre: 'Marta' });
  // 10+5+5 = 20 (lleno). Cualquier nueva debe fallar.
  const r = addParticipacion(db, { decimoId, importe: 1, nombre: 'X' });
  expect(r.ok).toBe(false);
  expect(r.error).toBe('supera_valor_total');
});

test('importe inválido es rechazado', () => {
  const r = addParticipacion(db, { decimoId, importe: -5 });
  expect(r.ok).toBe(false);
  expect(r.error).toBe('importe_invalido');
});
