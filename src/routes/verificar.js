// src/routes/verificar.js
// Endpoint público /verificar/<decimo_id> (sin login). Muestra valor total,
// participaciones emitidas, saldo restante y el resultado de validar la
// cadena de hashes. Con Open Graph dinámico para preview en WhatsApp.
const express = require('express');
const { openDb } = require('../db/schema');
const { computeChain } = require('../db/chain');
const router = express.Router();
const db = openDb();

router.get('/:id', (req, res) => {
  const decimo = db.prepare('SELECT * FROM decimos WHERE id = ?').get(req.params.id);
  if (!decimo) return res.status(404).send('<h1>Décimo no encontrado</h1>');

  const chain = computeChain(db, decimo.id);
  const parts = db
    .prepare('SELECT id, importe, nombre_participante, hash_actual FROM participaciones WHERE decimo_id = ? ORDER BY created_at ASC, id ASC')
    .all(decimo.id);
  const emitido = parts.reduce((s, p) => s + p.importe, 0);
  const saldo = decimo.valor_total - emitido;
  const rotaEn = chain.participaciones.find((p) => !p.ok);

  const base = `${req.protocol}://${req.get('host')}`;
  // Open Graph dinámico por participación (og:image apunta a una imagen generada)
  const ogImage = `${base}/og/participacion/${decimo.id}`;

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verificación del décimo ${decimo.numero} · ${decimo.sorteo}</title>
<meta name="description" content="Décimo ${decimo.numero} serie ${decimo.serie}: ${parts.length} participaciones, ${emitido.toFixed(2)}€ de ${decimo.valor_total.toFixed(2)}€ emitidos, cadena ${chain.ok ? 'ÍNTEGRA' : 'ALTERADA'}.">
<meta property="og:title" content="Décimo ${decimo.numero} · ${decimo.sorteo}">
<meta property="og:description" content="${parts.length} participaciones · ${emitido.toFixed(2)}€ / ${decimo.valor_total.toFixed(2)}€ · cadena ${chain.ok ? 'íntegra ✓' : '¡alterada!'}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="800">
<meta property="og:image:height" content="600">
<meta name="twitter:card" content="summary_large_image">
<style>
body{font-family:system-ui,sans-serif;background:#f8fafc;margin:0;padding:24px}
main{max-width:680px;margin:0 auto}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px;margin:16px 0}
.badge{display:inline-block;padding:4px 12px;border-radius:20px;font-weight:700;font-size:13px}
.ok{background:#dcfce7;color:#166534}.bad{background:#fee2e2;color:#991b1b}
table{width:100%;border-collapse:collapse;font-size:14px}
td,th{padding:8px;border-bottom:1px solid #f1f5f9;text-align:left}
th{color:#64748b;font-weight:600}
.mono{font-family:monospace;font-size:11px;color:#64748b}
.cta{display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;margin-top:12px}
</style></head><body>
<main>
<h1>🎄 Verificación del décimo</h1>
<div class="card">
<p><b>Número:</b> ${decimo.numero} · <b>Serie:</b> ${decimo.serie}</p>
<p><b>Sorteo:</b> ${decimo.sorteo}</p>
<p><b>Valor total:</b> ${decimo.valor_total.toFixed(2)} €</p>
<p><b>Emitido:</b> ${emitido.toFixed(2)} € · <b>Saldo restante:</b> ${saldo.toFixed(2)} €</p>
<p><b>Cadena de hashes:</b>
  <span class="badge ${chain.ok ? 'ok' : 'bad'}">${chain.ok ? 'ÍNTEGRA ✓' : '¡ALTERADA! ✗'}</span>
</p>
${chain.ok ? '' : `<p style="color:#b91c1c"><b>⚠ Se detectó manipulación.</b> La cadena se rompe en la participación "${rotaEn ? rotaEn.id.slice(0,8) : 'desconocida'}". Los importes NO son fiables.</p>`}
</div>
<div class="card">
<h2 style="margin-top:0">Participaciones (${parts.length})</h2>
<table><tr><th>Participante</th><th>Importe</th><th>Hash</th></tr>
${parts.map((p) => `<tr><td>${p.nombre_participante || 'Anónimo'}</td><td>${p.importe.toFixed(2)} €</td><td class="mono">${p.hash_actual.slice(0,12)}…</td></tr>`).join('')}
</table>
</div>
<a class="cta" href="/">← Volver al proyecto</a>
</main></body></html>`;
  res.send(html);
});

// Imagen OG dinámica (una por décimo, con número e importe emitido)
const { generarImagenOg } = require('../lib/og');
router.get('/og/participacion/:id', (req, res) => {
  try {
    const decimo = db.prepare('SELECT * FROM decimos WHERE id = ?').get(req.params.id);
    if (!decimo) return res.status(404).end();
    const parts = db.prepare('SELECT importe, nombre_participante FROM participaciones WHERE decimo_id = ?').all(decimo.id);
    const emitido = parts.reduce((s, p) => s + p.importe, 0);
    generarImagenOg({ numero: decimo.numero, serie: decimo.serie, emitido, valorTotal: decimo.valor_total, n: parts.length })
      .then((buf) => { res.set('Content-Type', 'image/png'); res.send(buf); })
      .catch((e) => { res.status(500).end(); });
  } catch (e) {
    res.status(500).end();
  }
});

module.exports = router;
