// src/routes/view.js
// Modelo de acceso AISLADO + SECRETO:
//
//  /  -> crear un décimo (sin listar nada)
//  /decimo/<id>  -> PANEL DEL ORGANIZADOR: solo su número (gestiona sus
//                   participaciones). Muestra los partícipes de SU décimo.
//  /participa/<decimo_id>  -> un partícipe aporta su parte (solo su form,
//                   sin ver a los demás)
//  /mi-participacion/<access_token>  -> ÚNICA vía al comprobante del
//                   partícipe (imagen + PDF). El token es un secreto de
//                   256 bits generado al crear la participación.
//  /verificar/<decimo_id>  -> verificación pública ANÓNIMA (agregados).
const express = require('express');
const { openDb } = require('../db/schema');
const { computeChain, addParticipacion } = require('../db/chain');
const crypto = require('crypto');
const path = require('path');
const router = express.Router();
const db = openDb();

// ---- Rate limiting simple por IP (memoria) ----
const intentos = new Map(); // ip -> { n, reset }
function rateLimit(ip, max = 20, ventanaMs = 10 * 60 * 1000) {
  const now = Date.now();
  const e = intentos.get(ip) || { n: 0, reset: now + ventanaMs };
  if (now > e.reset) { e.n = 0; e.reset = now + ventanaMs; }
  e.n += 1;
  intentos.set(ip, e);
  return e.n > max;
}
// Logging de accesos a /mi-participacion (para detectar fuerza bruta)
function logAcceso(ip, token, ok) {
  console.log(`[acceso] ${new Date().toISOString()} ip=${ip} ok=${ok} token_prefix=${token ? token.slice(0, 8) : 'none'}`);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function resumen(decimoId) {
  return db.prepare('SELECT COUNT(*) c, COALESCE(SUM(importe),0) s FROM participaciones WHERE decimo_id = ?').get(decimoId);
}
function base(req) { return `${req.protocol}://${req.get('host')}`; }
const css = `<style>
:root{--bg:#0f172a;--card:#1e293b;--line:#334155;--fg:#e2e8f0;--mut:#94a3b8;--accent:#2563eb}
*{box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:24px;line-height:1.5}
main{max-width:680px;margin:0 auto}
h1{font-size:26px;margin:0 0 4px}.muted{color:var(--mut);font-size:13px;margin:2px 0}
.mono{font-family:monospace;font-size:11px;color:var(--mut)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;margin:18px 0}
.badge{padding:4px 12px;border-radius:20px;font-weight:700;font-size:12px;white-space:nowrap}
.ok{background:#052e16;color:#4ade80}.bad{background:#450a0a;color:#f87171}
.kpis{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
.kpi{flex:1;min-width:100px;background:#0f172a;border-radius:10px;padding:10px 14px;text-align:center}
.kpi b{display:block;font-size:18px}.kpi span{font-size:11px;color:var(--mut)}
.bar{height:8px;background:#334155;border-radius:4px;overflow:hidden;margin:6px 0 16px}
.bar>div{height:100%;background:linear-gradient(90deg,#2563eb,#4ade80);border-radius:4px}
table{width:100%;border-collapse:collapse;font-size:14px;margin-bottom:8px}
td,th{padding:8px;border-bottom:1px solid var(--line);text-align:left}
th{color:var(--mut);font-weight:600;font-size:12px}
.join{background:#0f172a;border:1px dashed var(--line);border-radius:12px;padding:16px;margin-top:12px}
.join-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.join input{flex:1;min-width:120px;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);font-size:14px}
.join button{background:var(--accent);color:#fff;border:none;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer}
.msg{font-size:13px;margin-top:8px}.msg.ok{color:#4ade80}.msg.err{color:#f87171}
a{color:#60a5fa}
.btn{display:inline-block;background:var(--accent);color:#fff;padding:11px 18px;border-radius:8px;font-weight:700;text-decoration:none}
.btn-line{display:inline-block;padding:11px 18px;border-radius:8px;font-weight:700;text-decoration:none;border:1px solid var(--line)}
</style>`;

// 1. Raíz: crear un décimo
router.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Lotería Hash-Chain</title>${css}</head><body>
<main>
<h1>🎄 Lotería Hash-Chain</h1>
<p class="muted">Organiza un décimo de Lotería de Navidad en participaciones con cadena de hashes verificable.</p>
<div class="card">
<h2>Crear un décimo</h2>
<form method="POST" action="/decimos">
  <div class="join-row">
    <input name="numero" placeholder="Número (ej. 85432)" required>
    <input name="serie" placeholder="Serie (ej. 021)" required>
    <input name="sorteo" placeholder="Sorteo" value="Sorteo de Navidad 2026">
    <input name="valor_total" type="number" step="0.01" min="1" value="20" required>
    <button>Crear</button>
  </div>
</form>
<p class="muted" style="margin-top:10px">Cada partícipe recibe un comprobante con un <b>enlace secreto personal</b> (imagen + PDF). Nadie ve las aportaciones de los demás.</p>
</div>
</main></body></html>`);
});

// POST crear décimo
router.post('/decimos', (req, res) => {
  const numero = String(req.body.numero || '').trim();
  const serie = String(req.body.serie || '').trim();
  const sorteo = String(req.body.sorteo || 'Sorteo de Navidad 2026').trim();
  const valor_total = parseFloat(req.body.valor_total);
  if (!numero || !serie || !isFinite(valor_total) || valor_total <= 0)
    return res.status(400).send('Datos incompletos');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO decimos (id, organizador_id, numero, serie, sorteo, valor_total, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, null, numero, serie, sorteo, valor_total, new Date().toISOString());
  res.redirect(303, `/decimo/${id}`);
});

// 2. Panel del ORGANIZADOR (solo su número)
router.get('/decimo/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM decimos WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).send('Décimo no encontrado');
  const chain = computeChain(db, d.id);
  const agg = resumen(d.id);
  const parts = db.prepare('SELECT id, importe, nombre_participante, access_token FROM participaciones WHERE decimo_id = ? ORDER BY created_at ASC').all(d.id);
  const enlaceParticipar = `${base(req)}/participa/${d.id}`;
  const pct = d.valor_total > 0 ? Math.min(100, (agg.s / d.valor_total) * 100) : 0;
  const saldo = d.valor_total - agg.s;

  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Décimo ${d.numero} · gestión</title>${css}</head><body>
<main>
<p class="muted"><a href="/">← Crear otro décimo</a></p>
<div class="card">
  <div class="card-head" style="display:flex;justify-content:space-between;align-items:center">
    <div><h1 style="margin:0">Décimo ${esc(d.numero)} · ${esc(d.serie)}</h1>
    <p class="muted">${esc(d.sorteo)} · Panel <b>solo tuyo</b>: ves tu número y a quien participa.</p></div>
    <span class="badge ${chain.ok ? 'ok' : 'bad'}">${chain.ok ? 'ÍNTEGRA ✓' : 'ALTERADA ✗'}</span>
  </div>
  <div class="kpis">
    <div class="kpi"><b>${d.valor_total.toFixed(2)}€</b><span>total</span></div>
    <div class="kpi"><b>${agg.s.toFixed(2)}€</b><span>emitido</span></div>
    <div class="kpi"><b>${saldo.toFixed(2)}€</b><span>saldo libre</span></div>
    <div class="kpi"><b>${agg.c}</b><span>partícipes</span></div>
  </div>
  <div class="bar"><div style="width:${pct}%"></div></div>
  <p class="muted">🔗 Enlace para que aporten su parte: <a href="${enlaceParticipar}">${enlaceParticipar}</a></p>
</div>
<div class="card">
<h2>Participaciones de TU décimo (${parts.length})</h2>
${parts.length ? `<table><tr><th>Partícipe</th><th>Importe</th><th>Comprobante</th></tr>
${parts.map((p) => `<tr><td>${esc(p.nombre_participante) || 'Anónimo'}</td><td>${p.importe.toFixed(2)}€</td>
<td class="mono"><a href="/mi-participacion/${p.access_token}">abrir</a></td></tr>`).join('')}</table>`
  : '<p class="muted">Aún no hay participaciones.</p>'}
</div>
<div class="card">
<h2>➕ Añadir una participación</h2>
<form class="join" data-decimo="${d.id}">
  <div class="join-row">
    <input name="nombre" placeholder="Nombre del partícipe" required>
    <input name="importe" type="number" step="0.01" min="0.01" max="${saldo > 0 ? saldo : 0}" placeholder="Importe €" required>
    <button>Añadir</button>
  </div>
  <p class="msg"></p>
</form>
</div>
<p class="muted"><a href="/verificar/${d.id}">🔍 Verificación pública (anónima)</a></p>
</main>
<script>
document.querySelector('.join') && document.querySelector('.join').addEventListener('submit', async function(ev){
  ev.preventDefault();
  var form=ev.target, did=form.dataset.decimo;
  var nombre=form.querySelector('[name=nombre]').value;
  var importe=parseFloat(form.querySelector('[name=importe]').value);
  var msg=form.querySelector('.msg'); msg.className='msg'; msg.textContent='Generando...';
  var r=await fetch('/decimos/'+did+'/participaciones',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({importe,nombre})});
  var data=await r.json();
  if(!r.ok){msg.className='msg err';msg.textContent=data.message||data.error;return;}
  msg.className='msg ok';
  msg.innerHTML='✓ Comprobante: <a href="/mi-participacion/'+data.access_token+'">ver / enviar</a>';
  setTimeout(function(){location.reload();},1800);
});
</script>
</body></html>`);
});

// 3. Partícipe aporta su parte (sin ver a los demás)
router.get('/participa/:decimoId', (req, res) => {
  const d = db.prepare('SELECT * FROM decimos WHERE id = ?').get(req.params.decimoId);
  if (!d) return res.status(404).send('Décimo no encontrado');
  const chain = computeChain(db, d.id);
  const agg = resumen(d.id);
  const saldo = d.valor_total - agg.s;
  const pct = d.valor_total > 0 ? Math.min(100, (agg.s / d.valor_total) * 100) : 0;

  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Participa en el décimo ${d.numero}</title>${css}</head><body>
<main>
<div class="card">
  <h1>🎄 Participa en el décimo ${esc(d.numero)} · ${esc(d.serie)}</h1>
  <p class="muted">${esc(d.sorteo)}</p>
  <div class="kpis">
    <div class="kpi"><b>${d.valor_total.toFixed(2)}€</b><span>total</span></div>
    <div class="kpi"><b>${agg.s.toFixed(2)}€</b><span>ya aportado</span></div>
    <div class="kpi"><b>${saldo.toFixed(2)}€</b><span>disponible</span></div>
  </div>
  <div class="bar"><div style="width:${pct}%"></div></div>
  <p class="muted">Introduce <b>tu nombre</b> y <b>tu aportación</b>. No ves quién más participa. Al aportar recibes tu comprobante personal.</p>
  ${saldo > 0 ? `<form class="join" data-decimo="${d.id}">
    <div class="join-row">
      <input name="nombre" placeholder="Tu nombre" required>
      <input name="importe" type="number" step="0.01" min="0.01" max="${saldo}" placeholder="Tu aportación €" required>
      <button>Aportar</button>
    </div>
    <p class="msg"></p>
  </form>` : '<p class="full" style="color:#4ade80;font-weight:600">Este décimo ya está completo.</p>'}
</div>
</main>
<script>
document.querySelector('.join') && document.querySelector('.join').addEventListener('submit', async function(ev){
  ev.preventDefault();
  var form=ev.target, did=form.dataset.decimo;
  var nombre=form.querySelector('[name=nombre]').value;
  var importe=parseFloat(form.querySelector('[name=importe]').value);
  var msg=form.querySelector('.msg'); msg.className='msg'; msg.textContent='Generando tu comprobante...';
  var r=await fetch('/decimos/'+did+'/participaciones',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({importe,nombre})});
  var data=await r.json();
  if(!r.ok){msg.className='msg err';msg.textContent=data.message||data.error;return;}
  msg.className='msg ok';
  msg.innerHTML='✓ Aportación registrada. <a href="/mi-participacion/'+data.access_token+'"><b>Ver y descargar TU comprobante →</b></a>';
});
</script>
</body></html>`);
});

// 4. ÚNICA vía al comprobante del partícipe: /mi-participacion/<access_token>
//    Con rate-limiting (20 fallos/10min por IP) y logging.
router.get('/mi-participacion/:token', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || '?';
  const token = req.params.token || '';
  const p = db.prepare('SELECT * FROM participaciones WHERE access_token = ?').get(token);
  if (!p) {
    logAcceso(ip, token, false);
    if (rateLimit(ip)) {
      return res.status(429).send('Demasiados intentos. Inténtalo más tarde.');
    }
    return res.status(404).send('Comprobante no encontrado.');
  }
  logAcceso(ip, token, true);
  const d = db.prepare('SELECT * FROM decimos WHERE id = ?').get(p.decimo_id);
  const chain = computeChain(db, d.id);
  const linkVerif = `${base(req)}/verificar/${d.id}`;
  const pct = d.valor_total > 0 ? ((p.importe / d.valor_total) * 100).toFixed(2) : '0';

  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Tu participación · Décimo ${d.numero}</title>${css}</head><body>
<main>
<div class="card">
  <span class="badge ${chain.ok ? 'ok' : 'bad'}" style="margin-bottom:10px">Cadena del décimo: ${chain.ok ? 'ÍNTEGRA ✓' : 'ALTERADA ✗'}</span>
  <h1 style="margin:10px 0 4px">Tu participación</h1>
  <p class="muted">Comprobante personal. Solo quien tenga este enlace lo ve.</p>
  <div class="kpis">
    <div class="kpi"><b>Décimo ${esc(d.numero)}</b><span>serie ${esc(d.serie)}</span></div>
    <div class="kpi"><b>${p.importe.toFixed(2)}€</b><span>tu aportación</span></div>
    <div class="kpi"><b>${pct}%</b><span>del premio</span></div>
    <div class="kpi"><b>${esc(p.nombre_participante) || 'Anónimo'}</b><span>partícipe</span></div>
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
    <a href="/mi-participacion/${token}/imagen" class="btn">🖼 Descargar imagen</a>
    <a href="/mi-participacion/${token}/pdf" class="btn">📄 Descargar PDF</a>
    <a href="${linkVerif}" class="btn-line">🔍 Verificar el décimo</a>
  </div>
  <p class="muted" style="margin-top:14px">Comparte tu imagen o PDF por WhatsApp. El QR apunta a la verificación pública (anónima).</p>
</div>
</main></body></html>`);
});

// Descargas del comprobante — SOLO via access_token (misma ruta, con rate-limit)
function servirArchivo(tipo) {
  return (req, res) => {
    const ip = req.ip || req.connection.remoteAddress || '?';
    const token = req.params.token || '';
    const p = db.prepare('SELECT * FROM participaciones WHERE access_token = ?').get(token);
    if (!p) {
      logAcceso(ip, token, false);
      if (rateLimit(ip)) return res.status(429).end();
      return res.status(404).end();
    }
    logAcceso(ip, token, true);
    const dir = tipo === 'pdf' ? 'pdfs' : 'imagenes';
    res.sendFile(path.join(__dirname, '..', '..', 'output-samples', dir, `${p.id}.${tipo === 'pdf' ? 'pdf' : 'png'}`));
  };
}
router.get('/mi-participacion/:token/imagen', servirArchivo('png'));
router.get('/mi-participacion/:token/pdf', servirArchivo('pdf'));

module.exports = router;
