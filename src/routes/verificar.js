// src/routes/verificar.js
// Endpoint público /verificar/<decimo_id> (sin login) — ANÓNIMO:
// muestra valor total, nº de participaciones, saldo restante y validación de
// la cadena. NO expone nombres ni importes individuales de los partícipes.
const express = require('express');
const { openDb } = require('../db/schema');
const { computeChain } = require('../db/chain');
const router = express.Router();
const db = openDb();

router.get('/:id', (req, res) => {
  const decimo = db.prepare('SELECT * FROM decimos WHERE id = ?').get(req.params.id);
  if (!decimo) return res.status(404).send('<h1>Comprobante no encontrado</h1>');

  const chain = computeChain(db, decimo.id);
  const agg = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(importe),0) s FROM participaciones WHERE decimo_id = ?').get(decimo.id);
  const emitido = agg.s;
  const saldo = decimo.valor_total - emitido;
  // No exponer ids internos: la cadena rota se indica sin revelar el id de la participación.

  const base = `${req.protocol}://${req.get('host')}`;
  const ogImage = `${base}/verificar/og/participacion/${decimo.id}`;

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comprobar comprobante ${decimo.numero} · ${decimo.sorteo}</title>
<meta name="description" content="Décimo ${decimo.numero} serie ${decimo.serie}: ${agg.c} participaciones, ${emitido.toFixed(2)}€ de ${decimo.valor_total.toFixed(2)}€ emitidos, cadena ${chain.ok ? 'ÍNTEGRA' : 'ALTERADA'}.">
<meta property="og:title" content="Décimo ${decimo.numero} · ${decimo.sorteo}">
<meta property="og:description" content="${agg.c} participaciones · ${emitido.toFixed(2)}€ / ${decimo.valor_total.toFixed(2)}€ · cadena ${chain.ok ? 'íntegra ✓' : '¡alterada!'}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="800">
<meta property="og:image:height" content="600">
<meta name="twitter:card" content="summary_large_image">
<style>
body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:24px}
main{max-width:620px;margin:0 auto}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px;margin:16px 0}
.badge{display:inline-block;padding:4px 12px;border-radius:20px;font-weight:700;font-size:13px}
.ok{background:#dcfce7;color:#166534}.bad{background:#fee2e2;color:#991b1b}
.muted{color:#64748b;font-size:13px}
.kpi{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9}
.kpi b{font-size:16px}
</style></head><body>
<main>
<p style="font-size:13px"><a href="javascript:history.back()">← Volver</a> · <a href="/" style="color:#2563eb">🏠 Inicio</a></p>
<h1>🔍 Comprobar un comprobante</h1>
<div class="card">
<p><b>Número:</b> ${decimo.numero} · <b>Serie:</b> ${decimo.serie}</p>
<p><b>Sorteo:</b> ${decimo.sorteo}</p>
<p class="muted">Esta página es de verificación pública y <b>no muestra los nombres ni importes individuales</b> de los participantes.</p>
</div>
<div class="card">
<div class="kpi"><span>Valor total</span><b>${decimo.valor_total.toFixed(2)} €</b></div>
<div class="kpi"><span>Participaciones emitidas</span><b>${agg.c}</b></div>
<div class="kpi"><span>Importe emitido</span><b>${emitido.toFixed(2)} €</b></div>
<div class="kpi"><span>Saldo restante</span><b>${saldo.toFixed(2)} €</b></div>
<div class="kpi"><span>Cadena de hashes</span>
  <span class="badge ${chain.ok ? 'ok' : 'bad'}">${chain.ok ? 'ÍNTEGRA ✓' : '¡ALTERADA! ✗'}</span>
</div>
</div>
${chain.ok ? '' : '<div class="card" style="border-color:#dc2626"><p style="color:#b91c1c"><b>⚠ Se detectó manipulación.</b> La cadena está rota: los importes registrados NO coinciden con los originalmente emitidos. No son fiables.</p></div>'}
<p class="muted">La integridad se verifica encadenando cada participación por su hash (SHA-256). Cualquier alteración de un importe en la base rompe la cadena y esta página lo muestra.</p>
<div style="text-align:center;margin-top:20px;padding:10px 0">
  <a href="https://ko-fi.com/m_castillo" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:13.5px;color:#fff;background:#13C3A5;border-radius:7px;padding:11px 18px;text-decoration:none">☕ Invítame a un café</a>
</div>
</main>
</body></html>`;
  res.send(html);
});

// Imagen OG dinámica (una por registro, con número e importe registrado — sin nombres)
const { generarImagenOg } = require('../lib/og');
router.get('/og/participacion/:id', (req, res) => {
  try {
    const decimo = db.prepare('SELECT * FROM decimos WHERE id = ?').get(req.params.id);
    if (!decimo) return res.status(404).end();
    const agg = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(importe),0) s FROM participaciones WHERE decimo_id = ?').get(decimo.id);
    generarImagenOg({ numero: decimo.numero, serie: decimo.serie, emitido: agg.s, valorTotal: decimo.valor_total, n: agg.c })
      .then((buf) => { res.set('Content-Type', 'image/png'); res.send(buf); })
      .catch(() => { res.status(500).end(); });
  } catch (e) {
    res.status(500).end();
  }
});

module.exports = router;
