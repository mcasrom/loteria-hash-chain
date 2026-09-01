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
.del-btn{background:transparent;border:1px solid var(--line);color:#f87171;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:14px}
.del-btn:hover{background:rgba(248,113,113,.15);border-color:#f87171}
.share-btn{background:transparent;border:1px solid var(--line);color:var(--accent);width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:14px}
.share-btn:hover{background:rgba(59,130,246,.15);border-color:var(--accent)}
.join{background:#0f172a;border:1px dashed var(--line);border-radius:12px;padding:16px;margin-top:12px}
.join-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.join input{flex:1;min-width:120px;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);font-size:14px}
.join button{background:var(--accent);color:#fff;border:none;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer}
.msg{font-size:13px;margin-top:8px}.msg.ok{color:#4ade80}.msg.err{color:#f87171}
a{color:#60a5fa}
.btn{display:inline-block;background:var(--accent);color:#fff;padding:11px 18px;border-radius:8px;font-weight:700;text-decoration:none}
.btn-line{display:inline-block;padding:11px 18px;border-radius:8px;font-weight:700;text-decoration:none;border:1px solid var(--line)}
</style>`;

// 1. Raíz: landing completa y pulida (genérica para cualquier sorteo)
router.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Registro verificable de participaciones</title>
<meta name="description" content="Deja constancia de quién participa en un sorteo, boleto o reparto compartido, cuánto aporta y qué porcentaje le corresponde. Cada partícipe recibe un comprobante privado con QR y PDF.">
<meta property="og:title" content="Registro verificable de participaciones">
<meta property="og:description" content="Comparte un boleto. Deja el reparto por escrito. Comprobantes privados con QR y PDF.">
<style>
:root{--bg:#070b18;--bg2:#0d1528;--card:#101b33;--card2:#0a1226;--line:#1c2a47;--line2:#26365a;
--fg:#e8eefb;--mut:#8ba0c4;--accent:#f59e0b;--accent2:#3b82f6;--ok:#34d399;--warn:#fbbf24;--danger:#f87171;
--shadow:rgba(0,0,0,.4)}
[data-theme="light"]{--bg:#f6f8fc;--bg2:#ffffff;--card:#ffffff;--card2:#f0f4fa;--line:#dde4f0;--line2:#c3cee0;
--fg:#16213a;--mut:#5b6b85;--accent:#d97706;--accent2:#2563eb;--ok:#059669;--warn:#d97706;--danger:#dc2626;
--shadow:rgba(15,23,42,.12)}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{font-family:system-ui,-apple-system,sans-serif;background:radial-gradient(1000px 600px at 85% -5%,rgba(245,158,11,.10),transparent),
radial-gradient(800px 500px at 0% 0%,rgba(59,130,246,.10),transparent),var(--bg);color:var(--fg);margin:0;line-height:1.65}
.wrap{max-width:1060px;margin:0 auto;padding:0 24px}
.theme-btn{background:var(--card);border:1px solid var(--line);color:var(--fg);width:38px;height:38px;border-radius:10px;cursor:pointer;font-size:17px;display:inline-flex;align-items:center;justify-content:center;margin-left:14px}
.theme-btn:hover{background:var(--bg2)}
nav{display:flex;align-items:center;justify-content:space-between;padding:20px 0;border-bottom:1px solid var(--line)}
.nav-links{display:flex;align-items:center}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px}
.brand .logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--accent),#fb923c);display:flex;align-items:center;justify-content:center;font-size:18px}
nav a{color:var(--mut);text-decoration:none;font-size:14px;margin-left:22px}
nav a:hover{color:var(--fg)}
.hero{text-align:center;padding:60px 0 44px}
.hero .badge{display:inline-block;background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.3);color:var(--ok);font-size:12.5px;font-weight:700;padding:6px 14px;border-radius:30px;margin-bottom:18px}
.hero h1{font-size:42px;line-height:1.18;margin:0 0 16px;text-wrap:balance;background:linear-gradient(90deg,#fff,var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{font-size:18px;color:var(--mut);max-width:640px;margin:0 auto}
.hero .resp{font-size:14px;color:var(--mut);max-width:620px;margin:14px auto 0;font-style:italic}
.hero .sub-badges{margin-top:22px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.hero .sub-badges span{font-size:13px;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:20px;padding:6px 14px}
.cta-row{margin-top:30px;display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
.cta{display:inline-block;background:linear-gradient(90deg,var(--accent2),#60a5fa);color:#fff;padding:16px 32px;border-radius:12px;font-weight:800;font-size:16px;text-decoration:none;box-shadow:0 12px 34px rgba(59,130,246,.4)}
.cta:hover{transform:translateY(-2px)}
.cta2{display:inline-block;background:var(--card);color:var(--fg);border:1px solid var(--line2);padding:16px 32px;border-radius:12px;font-weight:700;font-size:16px;text-decoration:none}
.cta2:hover{border-color:var(--accent)}
section{padding:52px 0}
.sec-tag{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:800;margin:0 0 8px}
h2.sec{font-size:30px;margin:0 0 8px}
.sec-sub{color:var(--mut);font-size:15px;margin:0 0 30px}
.form-shell{background:linear-gradient(135deg,var(--card),var(--card2));border:1px solid var(--line);border-radius:20px;padding:34px;box-shadow:0 20px 60px var(--shadow)}
.form-shell h3{margin:0 0 6px;font-size:22px}
.form-shell .hint{color:var(--mut);font-size:14px;margin:0 0 22px}
.grid2{display:grid;gap:14px;grid-template-columns:1fr 1fr}
input,select{width:100%;padding:14px 15px;border-radius:11px;border:1px solid var(--line2);background:var(--bg2);color:var(--fg);font-size:15px;outline:none}
input:focus{border-color:var(--accent2)}
.btn-big{width:100%;margin-top:18px;background:linear-gradient(90deg,var(--accent2),#60a5fa);color:#fff;border:none;padding:16px;border-radius:12px;font-weight:800;font-size:17px;cursor:pointer}
.btn-big:hover{filter:brightness(1.1)}
.form-shell .mini{color:var(--mut);font-size:12.5px;margin:14px 0 0;text-align:center}
.steps{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}
.step{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:26px 22px;position:relative}
.step .n{position:absolute;top:18px;right:20px;font-size:40px;font-weight:800;color:rgba(255,255,255,.05)}
.step .ic{width:48px;height:48px;border-radius:12px;background:var(--bg2);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:14px}
.step b{font-size:17px;display:block;margin-bottom:6px}
.step p{color:var(--mut);font-size:14px;margin:0}
.feats{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.feat{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;display:flex;gap:14px;align-items:flex-start}
.feat .ic{font-size:24px;flex-shrink:0}
.feat b{display:block;font-size:16px;margin-bottom:4px}
.feat p{color:var(--mut);font-size:13.5px;margin:0}
.mock-wrap{display:grid;gap:24px;grid-template-columns:1.1fr .9fr;align-items:center}
@media(max-width:800px){.mock-wrap{grid-template-columns:1fr}}
.mock{background:linear-gradient(150deg,var(--bg2),var(--card));border:1px solid var(--line2);border-radius:18px;padding:24px;max-width:340px}
.mock .head{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.mock .num{font-family:monospace;font-size:30px;font-weight:800;color:var(--accent)}
.mock .serie{color:var(--mut);font-size:14px}
.mock .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line);font-size:14px}
.mock .row span{color:var(--mut)}
.mock .row b{font-size:15px}
.mock .qr{margin:18px auto 0;width:110px;height:110px;background:#fff;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#0a0f1e;font-weight:800;font-size:13px}
.mock-cap{color:var(--mut);font-size:13px;line-height:1.7}
.mock-cap b{color:var(--fg)}
.mock-cap ul{padding-left:18px;margin:12px 0 0}
footer{border-top:1px solid var(--line);margin-top:40px;padding:34px 0 50px;text-align:center;color:var(--mut);font-size:13px}
footer a{color:var(--accent);text-decoration:none}
</style></head><body>
<div class="wrap">
<nav>
  <div class="brand"><div class="logo">✓</div> Registro verificable de participaciones</div>
  <div class="nav-links"><a href="#registrar">Registrar participaciones</a><a href="#como">Cómo funciona</a><a href="#confianza">Seguridad y privacidad</a>
    <button class="theme-btn" onclick="toggleTheme()" aria-label="Cambiar tema">🌙</button>
  </div>
</nav>

<header class="hero">
  <span class="badge">Registro privado y verificable</span>
  <h1>Comparte un boleto. Deja el reparto por escrito.</h1>
  <p>Si ya tienes un décimo, una rifa, una apuesta o un bote compartido, registra quién participa, cuánto aporta y qué porcentaje del reparto le corresponde. Cada partícipe recibe un <b>comprobante privado</b> con QR y PDF.</p>
  <p class="resp">La herramienta no crea sorteos, no vende boletos, no custodia dinero y no garantiza resultados: documenta el acuerdo entre las personas participantes.</p>
  <div class="sub-badges"><span>🔗 Registro verificable</span><span>🔒 Comprobantes privados</span><span>📄 PDF de constancia</span><span>📱 Fácil de compartir</span></div>
  <div class="cta-row">
    <a class="cta" href="#registrar">🎟️ Crear registro de participaciones</a>
    <a class="cta2" href="#como">Ver un ejemplo</a>
  </div>
</header>

<section id="registrar">
  <div class="form-shell">
    <h3>🎟️ Registra un sorteo o reparto compartido</h3>
    <p class="hint">Añade los datos del boleto, rifa o reparto que ya existe. Después invita a las personas participantes.</p>
    <form method="POST" action="/decimos">
      <div class="grid2">
        <input name="numero" placeholder="Número (si lo hay, ej. 85432)">
        <input name="serie" placeholder="Serie (si lo hay)">
        <input name="sorteo" placeholder="Nombre del sorteo o reparto" value="Sorteo compartido">
        <input name="valor_total" type="number" step="0.01" min="1" value="20" placeholder="Importe de referencia €" required>
      </div>
      <button class="btn-big">🎟️ Crear el registro de participaciones</button>
    </form>
    <p class="mini">Al crear el registro recibirás un enlace privado de gestión. Cada partícipe tendrá su propio comprobante y no podrá ver los importes de los demás.</p>
  </div>
</section>

<section id="como">
  <p class="sec-tag">Así de simple</p>
  <h2 class="sec">Tres pasos</h2>
  <p class="sec-sub">Sin cuentas, sin listas públicas, sin custodiar dinero ni boletos.</p>
  <div class="steps">
    <div class="step"><span class="n">1</span><div class="ic">🎟️</div><b>Registra el boleto o sorteo</b><p>Introduce el número, la serie y el importe de referencia. Obtienes un panel privado para gestionar el reparto.</p></div>
    <div class="step"><span class="n">2</span><div class="ic">📤</div><b>Comparte el enlace de participación</b><p>Envías el enlace a las personas que participarán. Cada una registra su aportación sin acceder a la información de las demás.</p></div>
    <div class="step"><span class="n">3</span><div class="ic">📲</div><b>Entrega los comprobantes</b><p>Cada partícipe recibe una imagen con QR y un PDF privado para guardar o compartir por WhatsApp.</p></div>
  </div>
</section>

<section>
  <p class="sec-tag">Lo que obtienes</p>
  <h2 class="sec">Un comprobante privado para cada partícipe</h2>
  <p class="sec-sub">Imagen + PDF, con QR para comprobar la integridad del registro.</p>
  <div class="mock-wrap">
    <div class="mock">
      <div class="head"><div class="num">85432</div><div class="serie">serie 021</div></div>
      <div class="row"><span>Partícipe</span><b>Ana</b></div>
      <div class="row"><span>Importe aportado</span><b>10,00 €</b></div>
      <div class="row"><span>Porcentaje de reparto</span><b>50%</b></div>
      <div class="row"><span>Estado</span><b style="color:var(--ok)">Registro íntegro ✓</b></div>
      <div class="qr">QR</div>
    </div>
    <div class="mock-cap">
      <p style="margin-top:0">Cada comprobante incluye:</p>
      <ul>
        <li>Número, serie y referencia del sorteo o boleto.</li>
        <li>Nombre declarado del partícipe e <b>importe aportado</b>.</li>
        <li><b>Porcentaje de reparto</b> asignado.</li>
        <li>QR para comprobar la <b>integridad del registro</b> sin revelar datos privados.</li>
        <li>PDF privado con los datos del acuerdo.</li>
        <li>Un <b>enlace privado personal</b>. Guárdalo: por seguridad, no se muestra de nuevo.</li>
      </ul>
      <p style="margin-bottom:0">El enlace del comprobante está <b>protegido con un token aleatorio de 256 bits</b>, diseñado para impedir la enumeración y los accesos no autorizados.</p>
    </div>
  </div>
</section>

<section id="confianza">
  <p class="sec-tag">Por qué</p>
  <h2 class="sec">Un acuerdo claro, privado y verificable</h2>
  <p class="sec-sub">Menos malentendidos. Más constancia del acuerdo.</p>
  <div class="feats">
    <div class="feat"><div class="ic">🔗</div><div><b>Integridad verificable</b><p>Cada registro queda vinculado al anterior mediante hashes. Si se altera un dato registrado, la comprobación de integridad puede detectarlo.</p></div></div>
    <div class="feat"><div class="ic">🔒</div><div><b>Comprobantes privados</b><p>Cada persona accede solo a su propio comprobante. Los nombres y aportaciones individuales no se publican.</p></div></div>
    <div class="feat"><div class="ic">🕵️</div><div><b>Verificación sin exponer datos</b><p>El QR permite consultar el estado del registro sin mostrar la identidad ni el importe de cada partícipe.</p></div></div>
    <div class="feat"><div class="ic">📄</div><div><b>Documento de constancia</b><p>Cada comprobante incluye los datos del acuerdo de participación y reparto, para conservarlos en PDF.</p></div></div>
    <div class="feat"><div class="ic">🛡️</div><div><b>Acceso protegido</b><p>Los enlaces personales usan tokens aleatorios de alta entropía y el sistema aplica límites frente a intentos repetidos de acceso.</p></div></div>
    <div class="feat"><div class="ic">🧾</div><div><b>Reparto transparente</b><p>Cada partícipe ve el porcentaje de reparto registrado para su participación.</p></div></div>
  </div>
</section>

<section>
  <p class="sec-tag">Transparencia</p>
  <h2 class="sec">Qué hace esto — y qué no</h2>
  <div class="feats" style="grid-template-columns:1fr 1fr">
    <div class="feat" style="border-color:rgba(52,211,153,.3)"><div class="ic">✅</div><div><b>Registra</b><p style="margin-bottom:4px">· Quién participa y cuánto aporta cada persona.<br>· Qué porcentaje del reparto corresponde a cada partícipe.<br>· Que los importes registrados no se alteran después de emitirse (hash encadenado).</p></div></div>
    <div class="feat" style="border-color:rgba(248,113,113,.3)"><div class="ic">⚠️</div><div><b>No verifica</b><p style="margin-bottom:0">· La existencia, validez o custodia del boleto: eso es responsabilidad de quien lo guarda.<br>· La identidad real de las personas (se registra el nombre que se declara).<br>· El resultado oficial del sorteo ni el pago de premios.</p></div></div>
  </div>
  <p class="sec-sub" style="margin-top:18px;font-size:13px;font-style:italic;text-align:center">
    El comprobante documenta el acuerdo declarado entre las personas participantes. Su valor probatorio dependerá de las circunstancias, de la información aportada y de la normativa aplicable.
  </p>
</section>

<footer>
  <b>Registro verificable de participaciones</b> · Para décimos, rifas, botes, apuestas y repartos compartidos<br>
  <a href="#registrar">Crear un registro</a> · <a href="#como">Cómo funciona</a> · <a href="#confianza">Privacidad y seguridad</a> · <a href="mailto:info@viajeinteligencia.com">info@viajeinteligencia.com</a><br>
  <span style="font-size:11.5px;opacity:.75">versión 0.2.0 · Proyecto independiente y de código abierto</span>
</footer>
</div>
<script>
(function(){
  var root = document.documentElement;
  var btn = document.querySelector('.theme-btn');
  function apply(t){
    if (t === 'light') { root.setAttribute('data-theme','light'); btn.textContent = '☀️'; }
    else { root.removeAttribute('data-theme'); btn.textContent = '🌙'; }
  }
  var saved = 'light';
  try { saved = localStorage.getItem('tema') || 'dark'; } catch(e){}
  apply(saved === 'light' ? 'light' : 'dark');
  window.toggleTheme = function(){
    var cur = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    apply(cur);
    try { localStorage.setItem('tema', cur); } catch(e){}
  };
})();
</script>
</body></html>`);
});

// POST crear décimo
router.post('/decimos', (req, res) => {
  const numero = String(req.body.numero || '').trim();
  const serie = String(req.body.serie || '').trim();
  const sorteo = String(req.body.sorteo || 'Sorteo compartido').trim();
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
<p class="muted"><a href="/">← Registrar otro sorteo</a></p>
<div class="card">
  <div class="card-head" style="display:flex;justify-content:space-between;align-items:center">
    <div><h1 style="margin:0">Registro ${esc(d.numero)} · ${esc(d.serie)}</h1>
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
${parts.length ? `<table><tr><th>Partícipe</th><th>Importe</th><th>Comprobante</th><th>Compartir</th><th></th></tr>
${parts.map((p, i) => {
  const esUltima = i === parts.length - 1;
  const linkPart = `${base(req)}/mi-participacion/${p.access_token}`;
  return `<tr><td>${esc(p.nombre_participante) || 'Anónimo'}</td><td>${p.importe.toFixed(2)}€</td>
<td class="mono"><a href="${linkPart}" target="_blank">abrir</a></td>
<td><button class="share-btn" onclick="compartir('${linkPart}','${esc(p.nombre_participante) || 'tu'}','${d.id}')">📤</button></td>
<td>${esUltima ? `<button class="del-btn" onclick="eliminarUltima('${d.id}')" title="Eliminar la última participación (si hubo un error)">🗑</button>` : ''}</td></tr>`;
}).join('')}</table>
<p class="muted" style="font-size:12px">📤 Compartir copia el enlace del comprobante o lo abre en WhatsApp con el texto listo. 🗑 Solo se puede eliminar la <b>última</b> participación (para corregir un doble clic o un error). Las anteriores no se tocan para no romper la cadena de integridad.</p>`
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
function compartir(link, nombre, did){
  var texto = '🎟️ Tu participación está registrada. Abre tu comprobante aquí: ' + link;
  var op = confirm('Compartir con ' + nombre + ':\n\n[OK] Copiar enlace\n[Cancelar] Abrir WhatsApp con el mensaje listo');
  if (op) {
    // copiar al portapapeles
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
      .then(function(){ alert('Enlace copiado: ' + link); })
      .catch(function(){
        // fallback: prompt para copiar manual
        prompt('Copia este enlace:', link);
      });
  } else {
    var wa = 'https://wa.me/?text=' + encodeURIComponent(texto);
    window.open(wa, '_blank');
  }
}
async function eliminarUltima(did){
  if(!confirm('¿Eliminar la última participación? Esta acción no se puede deshacer. La cadena de integridad se mantiene (solo se quita la última).')) return;
  var r=await fetch('/decimos/'+did+'/participaciones/ultima',{method:'DELETE'});
  var data=await r.json();
  if(!r.ok){alert(data.message||data.error);return;}
  alert('Participación eliminada: '+(data.eliminada.nombre||'Anónimo')+' ('+data.eliminada.importe.toFixed(2)+'€)');
  location.reload();
}
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
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Participa en ${d.numero} (sorteo compartido)</title>${css}</head><body>
<main>
<div class="card">
  <h1>🎟️ Participa en ${esc(d.numero)} · ${esc(d.serie)}</h1>
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
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Tu comprobante · ${d.numero}</title>${css}</head><body>
<main>
<div class="card">
  <span class="badge ${chain.ok ? 'ok' : 'bad'}" style="margin-bottom:10px">Cadena del décimo: ${chain.ok ? 'ÍNTEGRA ✓' : 'ALTERADA ✗'}</span>
  <h1 style="margin:10px 0 4px">Tu participación</h1>
  <p class="muted">Comprobante personal. Solo quien tenga este enlace lo ve.</p>
  <div class="kpis">
    <div class="kpi"><b>${esc(d.numero)}</b><span>serie ${esc(d.serie)}</span></div>
    <div class="kpi"><b>${p.importe.toFixed(2)}€</b><span>tu aportación</span></div>
    <div class="kpi"><b>${pct}%</b><span>de participación</span></div>
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
