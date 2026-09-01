// scripts/seed.js
// Crea un décimo de ejemplo (número 85432, valor 20€) con 3 participaciones
// (10€, 5€, 5€). Fácil de probar a mano.
const { openDb } = require('../src/db/schema');
const { addParticipacion, validateChain } = require('../src/db/chain');
const crypto = require('crypto');

const db = openDb();

// Décimo de ejemplo
const decimo = {
  id: crypto.randomUUID(),
  numero: '85432',
  serie: '021',
  sorteo: 'Sorteo de Navidad 2026',
  valor_total: 20,
  created_at: new Date().toISOString(),
};
db.prepare('INSERT INTO decimos (id, organizador_id, numero, serie, sorteo, valor_total, created_at) VALUES (?,?,?,?,?,?,?)')
  .run(decimo.id, null, decimo.numero, decimo.serie, decimo.sorteo, decimo.valor_total, decimo.created_at);

// 3 participaciones: 10€, 5€, 5€ = 20€ exacto
const p1 = addParticipacion(db, { decimoId: decimo.id, importe: 10, nombre: 'Ana' });
const p2 = addParticipacion(db, { decimoId: decimo.id, importe: 5, nombre: 'Luis' });
const p3 = addParticipacion(db, { decimoId: decimo.id, importe: 5, nombre: 'Marta' });

console.log('Décimo creado:');
console.log('  id:', decimo.id);
console.log('  número:', decimo.numero, '| serie:', decimo.serie, '| valor:', decimo.valor_total, '€');
console.log('Participaciones:');
console.log('  1:', JSON.stringify(p1.participacion || p1));
console.log('  2:', JSON.stringify(p2.participacion || p2));
console.log('  3:', JSON.stringify(p3.participacion || p3));
console.log('Cadena íntegra:', validateChain(db, decimo.id) ? 'SÍ ✓' : 'NO ✗');

db.close();
