// scripts/generar_entregables.js
// Genera imágenes y PDFs de las participaciones existentes en la BD,
// guardándolos en output-samples/ para revisarlos sin levantar el server.
const { openDb } = require('../src/db/schema');
const { generarImagen } = require('../src/lib/imagen');
const { generarPdf } = require('../src/lib/pdf');

(async () => {
  const db = openDb();
  const decimos = db.prepare('SELECT * FROM decimos').all();
  for (const d of decimos) {
    const parts = db.prepare('SELECT * FROM participaciones WHERE decimo_id = ?').all(d.id);
    console.log(`Décimo ${d.numero} (${d.id.slice(0,8)}): ${parts.length} participaciones`);
    for (const p of parts) {
      try {
        const img = await generarImagen({
          participacionId: p.id, numero: d.numero, serie: d.serie, sorteo: d.sorteo,
          importe: p.importe, nombre: p.nombre_participante, decimoId: d.id,
          baseUrl: 'http://localhost:3005', accessToken: p.access_token,
        });
        const pdf = await generarPdf({
          participacionId: p.id, numero: d.numero, serie: d.serie, sorteo: d.sorteo,
          importe: p.importe, nombre: p.nombre_participante, valorTotal: d.valor_total, decimoId: d.id,
        });
        console.log(`  ✓ ${p.nombre_participante || 'Anónimo'} (${p.importe}€) -> ${img.split('/').slice(-2).join('/')} | ${pdf.split('/').slice(-2).join('/')}`);
      } catch (e) {
        console.error(`  ✗ ${p.id}: ${e.message}`);
      }
    }
  }
  db.close();
})();
