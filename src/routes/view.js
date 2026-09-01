// src/routes/view.js
// Página principal con PRIVACIDAD:
// - NO lista participaciones con nombres (cada participante ve solo la suya)
// - Muestra resumen del décimo (total, emitido, saldo, nº participaciones)
// - Formulario para añadir TU participación -> recibe tu imagen/PDF
// - Tras participar, muestra SOLO tu participación con tu descarga
const express = require('express');
const { openDb } = require('../db/schema');
const { computeChain } = require('../db/chain');
const path = require('path');
const router = express.Router();
const db = openDb();

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Ruta raíz: resumen del/los décimos SIN nombres de participantes
router.get('/', (req, res) => {
  const decimos = db.prepare('SELECT * FROM decimos ORDER BY created_at DESC LIMIT 5').all();
  const items = decimos.map((d) => {
    const chain = computeChain(db, d.id);
    const total = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(importe),0) s FROM participaciones WHERE decimo_id = ?').get(d.id);
    return { ...d, integro: chain.ok, n: total.c, emitido: total.s, saldo: d.valor_total - total.s };
  });
  res.send(render(items));
});

function render(items) {
  const cards = items.map((d) => {
    const pct = d.valor_total > 0 ? Math.min(100, (d.emitido / d.valor_total) * 100) : 0;
    return `
    <div class="card">
      <div class="card-head">
        <div>
          <h2>Décimo ${esc(d.numero)} · Serie ${esc(d.serie)}</h2>
          <p class="muted">${esc(d.sorteo)} · id: <span class="mono">${d.id.slice(0, 8)}…</span></p>
        </div>
        <span class="badge ${d.integro ? 'ok' : 'bad'}">${d.integro ? 'ÍNTEGRA ✓' : 'ALTERADA ✗'}</span>
      </div>
      <div class="kpis">
        <div class="kpi"><b>${d.valor_total.toFixed(2)}€</b><span>valor total</span></div>
        <div class="kpi"><b>${d.emitido.toFixed(2)}€</b><span>emitido</span></div>
        <div class="kpi"><b>${d.saldo.toFixed(2)}€</b><span>saldo libre</span></div>
        <div class="kpi"><b>${d.n}</b><span>participaciones</span></div>
      </div>
      <div class="bar"><div style="width:${pct}%"></div></div>

      ${d.saldo > 0 ? `
      <form class="join" data-decimo="${d.id}">
        <h3>➕ Añadir tu participación</h3>
        <p class="muted">Solo introduces tu nombre y cuánto aportas. No ves a los demás participantes. Recibirás tu imagen y PDF con el QR de verificación.</p>
        <div class="join-row">
          <input name="nombre" placeholder="Tu nombre" required>
          <input name="importe" type="number" step="0.01" min="0.01" max="${d.saldo}" placeholder="Importe €" required>
          <button type="submit">Participar</button>
        </div>
        <p class="join-msg"></p>
      </form>` : '<p class="full">Completo — no quedan participaciones.</p>'}
      <p class="muted" style="margin-top:10px"><a href="/verificar/${d.id}" style="color:#60a5fa">🔍 Verificación pública (anónima)</a></p>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lotería Hash-Chain · Décimo en participaciones verificable</title>
<meta name="description" content="Reparte un décimo de Lotería de Navidad en participaciones con cadena de hashes verificable. Cada participante recibe su imagen, PDF y QR de verificación, sin exponer a los demás.">
<meta property="og:title" content="Lotería Hash-Chain · Décimo en participaciones verificable">
<style>
:root{--bg:#0f172a;--card:#1e293b;--line:#334155;--fg:#e2e8f0;--mut:#94a3b8;--accent:#2563eb}
*{box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:24px;line-height:1.5}
main{max-width:720px;margin:0 auto}
h1{font-size:26px;margin:0 0 4px}.muted{color:var(--mut);font-size:13px;margin:2px 0}
.mono{font-family:monospace;font-size:11px;color:var(--mut)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;margin:18px 0}
.card-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.card-head h2{margin:0;font-size:20px}
.badge{padding:4px 12px;border-radius:20px;font-weight:700;font-size:12px;white-space:nowrap}
.ok{background:#052e16;color:#4ade80}.bad{background:#450a0a;color:#f87171}
.kpis{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
.kpi{flex:1;min-width:110px;background:#0f172a;border-radius:10px;padding:10px 14px;text-align:center}
.kpi b{display:block;font-size:18px}
.kpi span{font-size:11px;color:var(--mut)}
.bar{height:8px;background:#334155;border-radius:4px;overflow:hidden;margin:6px 0 16px}
.bar>div{height:100%;background:linear-gradient(90deg,#2563eb,#4ade80);border-radius:4px}
.join{background:#0f172a;border:1px dashed var(--line);border-radius:12px;padding:16px;margin-top:10px}
.join h3{margin:0 0 4px;font-size:15px}
.join-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.join input{flex:1;min-width:120px;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);font-size:14px}
.join button{background:var(--accent);color:#fff;border:none;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer}
.join-msg{font-size:13px;margin-top:8px}
.join-msg.ok{color:#4ade80}.join-msg.err{color:#f87171}
.full{color:#4ade80;font-weight:600;font-size:13px}
.resultado{border:1px solid #4ade80;border-radius:12px;padding:16px;margin-top:14px;background:#052e16}
.resultado a{color:#60a5fa}
</style></head><body>
<main>
<h1>🎄 Lotería Hash-Chain</h1>
<p class="muted">Décimo de Lotería de Navidad repartido en participaciones. Cada partícipe aporta su importe y recibe su <b>imagen</b>, su <b>PDF legal</b> y un <b>QR de verificación</b>. La cadena de hashes detecta si alguien altera los importes. <b>Privacidad:</b> no se muestran los nombres de los demás participantes.</p>
${cards}
<p class="muted" style="margin-top:24px">Cada participación genera un hash encadenado (SHA-256). Si se modifica un importe en la base de datos, la verificación pública lo detecta y muestra "ALTERADA".</p>
</main>
<script>
document.querySelectorAll('.join').forEach(function(form) {
  form.addEventListener('submit', async function(ev) {
    ev.preventDefault();
    var did = form.dataset.decimo;
    var nombre = form.querySelector('[name=nombre]').value;
    var importe = parseFloat(form.querySelector('[name=importe]').value);
    var msg = form.querySelector('.join-msg');
    msg.className = 'join-msg';
    msg.textContent = 'Generando...';
    try {
      var r = await fetch('/decimos/' + did + '/participaciones', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({importe: importe, nombre: nombre})
      });
      var data = await r.json();
      if (!r.ok) { msg.className='join-msg err'; msg.textContent = data.message || data.error; return; }
      msg.className = 'join-msg ok';
      msg.innerHTML = '<div class="resultado">✓ Tu participación de <b>'+data.participacion.importe.toFixed(2)+'€</b> está creada.<br>' +
        '<a href="/participacion/'+data.participacion.id+'/imagen" download>🖼 Descargar tu imagen</a> · ' +
        '<a href="/participacion/'+data.participacion.id+'/pdf" download>📄 Descargar tu PDF</a><br>' +
        '<span class="muted">Guarda estos archivos: son tu comprobante con QR de verificación.</span></div>';
      msg.querySelector('.muted').style.color='#94a3b8';
    } catch(e) { msg.className='join-msg err'; msg.textContent='Error de red'; }
  });
});
</script>
</body></html>`;
}

// Servir imagen de una participación (solo conociendo el id)
router.get('/participacion/:id/imagen', (req, res) => {
  const p = db.prepare('SELECT * FROM participaciones WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).end();
  const file = path.join(__dirname, '..', '..', 'output-samples', 'imagenes', `${p.id}.png`);
  res.sendFile(file);
});

// Servir PDF de una participación
router.get('/participacion/:id/pdf', (req, res) => {
  const p = db.prepare('SELECT * FROM participaciones WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).end();
  const file = path.join(__dirname, '..', '..', 'output-samples', 'pdfs', `${p.id}.pdf`);
  res.sendFile(file);
});

module.exports = router;
