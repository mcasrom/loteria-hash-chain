// scripts/regen_imagenes.js
// Regenera los PNG de comprobante de TODAS las participaciones (las imágenes
// se generan una vez y se sirven cacheadas; al corregir el layout hay que
// rehacerlas). Uso: node scripts/regen_imagenes.js [baseUrl]
const { openDb } = require('../src/db/schema');
const { generarImagen } = require('../src/lib/imagen');

(async () => {
  const baseUrl = process.argv[2] || process.env.BASE_URL || 'https://loteria-hash.pruebapublica.com';
  const db = openDb();
  const rows = db.prepare(`
    SELECT p.id, p.access_token, p.modalidad, p.importe, p.importe_aportado,
           p.valor_referencia, p.nombre_participante,
           d.id AS decimo_id, d.numero, d.serie, d.sorteo
    FROM participaciones p JOIN decimos d ON d.id = p.decimo_id
  `).all();
  console.log(`participaciones: ${rows.length} · baseUrl=${baseUrl}`);
  for (const p of rows) {
    const f = await generarImagen({
      participacionId: p.id,
      numero: p.numero,
      serie: p.serie,
      sorteo: p.sorteo,
      importe: p.importe,
      nombre: p.nombre_participante,
      decimoId: p.decimo_id,
      baseUrl,
      accessToken: p.access_token,
      modalidad: p.modalidad,
      importeAportado: p.importe_aportado,
    });
    console.log(`  regen ${p.id} (${p.modalidad}) -> ${f}`);
  }
  console.log('OK');
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
