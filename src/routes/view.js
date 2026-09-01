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

// 1. Raíz: landing completa y pulida (genérica para cualquier sorteo)
router.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reparte participaciones de sorteos con comprobante</title>
<meta name="description" content="Organiza participaciones de cualquier sorteo, rifa o décimo. Cada persona aporta su parte y recibe su comprobante con QR. Con integridad y privacidad.">
<meta property="og:title" content="Participaciones de sorteos con comprobante">
<meta property="og:description" content="Crea tu sorteo, comparte el enlace, cada uno recibe su comprobante con QR. Integro y privado.">
<style>
:root{--bg:#070b18;--bg2:#0d1528;--card:#101b33;--card2:#0a1226;--line:#1c2a47;--line2:#26365a;
--fg:#e8eefb;--mut:#8ba0c4;--accent:#f59e0b;--accent2:#3b82f6;--ok:#34d399;--warn:#fbbf24;--danger:#f87171}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{font-family:system-ui,-apple-system,sans-serif;background:radial-gradient(1000px 600px at 85% -5%,rgba(245,158,11,.10),transparent),
radial-gradient(800px 500px at 0% 0%,rgba(59,130,246,.10),transparent),var(--bg);color:var(--fg);margin:0;line-height:1.65}
.wrap{max-width:1060px;margin:0 auto;padding:0 24px}
/* NAV */
nav{display:flex;align-items:center;justify-content:space-between;padding:20px 0;border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px}
.brand .logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--accent),#fb923c);display:flex;align-items:center;justify-content:center;font-size:18px}
nav a{color:var(--mut);text-decoration:none;font-size:14px;margin-left:22px}
nav a:hover{color:var(--fg)}
/* HERO */
.hero{text-align:center;padding:64px 0 48px}
.hero .badge{display:inline-block;background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.3);color:var(--ok);font-size:12.5px;font-weight:700;padding:6px 14px;border-radius:30px;margin-bottom:18px}
.hero h1{font-size:40px;line-height:1.18;margin:0 0 16px;text-wrap:balance;background:linear-gradient(90deg,#fff,var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{font-size:18px;color:var(--mut);max-width:620px;margin:0 auto}
.hero .sub-badges{margin-top:22px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.hero .sub-badges span{font-size:13px;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:20px;padding:6px 14px}
.cta{display:inline-block;margin-top:30px;background:linear-gradient(90deg,var(--accent2),#60a5fa);color:#fff;padding:16px 36px;border-radius:12px;font-weight:800;font-size:17px;text-decoration:none;box-shadow:0 12px 34px rgba(59,130,246,.4)}
.cta:hover{transform:translateY(-2px);box-shadow:0 16px 40px rgba(59,130,246,.5)}
/* SECCIONES */
section{padding:56px 0}
.sec-tag{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:800;margin:0 0 8px}
h2.sec{font-size:30px;margin:0 0 8px}
.sec-sub{color:var(--mut);font-size:15px;margin:0 0 30px}
/* FORM */
.form-shell{background:linear-gradient(135deg,var(--card),var(--card2));border:1px solid var(--line);border-radius:20px;padding:34px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
.form-shell h3{margin:0 0 6px;font-size:22px}
.form-shell .hint{color:var(--mut);font-size:14px;margin:0 0 22px}
.grid2{display:grid;gap:14px;grid-template-columns:1fr 1fr}
input,select{width:100%;padding:14px 15px;border-radius:11px;border:1px solid var(--line2);background:var(--bg2);color:var(--fg);font-size:15px;outline:none}
input:focus{border-color:var(--accent2)}
.btn-big{width:100%;margin-top:18px;background:linear-gradient(90deg,var(--accent2),#60a5fa);color:#fff;border:none;padding:16px;border-radius:12px;font-weight:800;font-size:17px;cursor:pointer}
.btn-big:hover{filter:brightness(1.1)}
.form-shell .mini{color:var(--mut);font-size:12.5px;margin:14px 0 0;text-align:center}
/* PASOS */
.steps{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}
.step{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:26px 22px;position:relative}
.step .n{position:absolute;top:18px;right:20px;font-size:40px;font-weight:800;color:rgba(255,255,255,.05)}
.step .ic{width:48px;height:48px;border-radius:12px;background:var(--bg2);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:14px}
.step b{font-size:17px;display:block;margin-bottom:6px}
.step p{color:var(--mut);font-size:14px;margin:0}
/* FEATURES */
.feats{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.feat{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;display:flex;gap:14px;align-items:flex-start}
.feat .ic{font-size:24px;flex-shrink:0}
.feat b{display:block;font-size:16px;margin-bottom:4px}
.feat p{color:var(--mut);font-size:13.5px;margin:0}
/* MOCK */
.mock-wrap{display:grid;gap:24px;grid-template-columns:1.1fr .9fr;align-items:center}
@media(max-width:800px){.mock-wrap{grid-template-columns:1fr}}
.mock{background:linear-gradient(150deg,#1a2747,#101b33);border:1px solid var(--line2);border-radius:18px;padding:24px;max-width:340px}
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
/* FAQ */
.faq details{border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin-bottom:10px;background:var(--card)}
.faq summary{cursor:pointer;font-weight:600;font-size:15px;color:var(--fg)}
.faq details p{color:var(--mut);font-size:14px;margin:12px 0 0}
/* FOOTER */
footer{border-top:1px solid var(--line);margin-top:40px;padding:34px 0 50px;text-align:center;color:var(--mut);font-size:13px}
footer a{color:var(--accent);text-decoration:none}
</style></head><body>
<div class="wrap">
<nav>
  <div class="brand"><div class="logo">🎟️</div> Sorteos en Participaciones</div>
  <div><a href="#crear">Crear sorteo</a><a href="#como">Cómo funciona</a><a href="#metodo">Metodología</a></div>
</nav>

<header class="hero">
  <span class="badge">✓ Comprobante con QR · ✓ Privado · ✓ Integro</span>
  <h1>Reparte cualquier sorteo en participaciones, sin líos</h1>
  <p>Décimo de Navidad, rifa del cole, apuesta entre amigos, evento solidario... Cada persona aporta su parte y recibe su <b>comprobante personal</b> con QR. Tú ves tu sorteo; cada partícipe ve solo lo suyo.</p>
  <div class="sub-badges"><span>🔗 Cadena de integridad</span><span>🔒 Comprobante privado</span><span>📄 PDF legal</span><span>📱 Listo para WhatsApp</span></div>
  <a class="cta" href="#crear">🎟️ Crear mi sorteo</a>
</header>

<section id="crear">
  <div class="form-shell">
    <h3>🎟️ Crea tu sorteo o reparto</h3>
    <p class="hint">Solo necesitas estos datos para empezar. El resto lo hace la herramienta.</p>
    <form method="POST" action="/decimos">
      <div class="grid2">
        <input name="numero" placeholder="Número (si lo hay, ej. 85432)">
        <input name="serie" placeholder="Serie (si lo hay)">
        <input name="sorteo" placeholder="Nombre del sorteo o evento" value="Sorteo compartido">
        <input name="valor_total" type="number" step="0.01" min="1" value="20" placeholder="Valor total €" required>
      </div>
      <button class="btn-big">🎟️ Crear reparto</button>
    </form>
    <p class="mini">Al crearlo obtienes un enlace privado de gestión. Cada partícipe recibe su comprobante; nadie ve lo que aportan los demás.</p>
  </div>
</section>

<section id="como">
  <p class="sec-tag">Así de simple</p>
  <h2 class="sec">Tres pasos</h2>
  <p class="sec-sub">Sin cuentas, sin registros, sin listas raras.</p>
  <div class="steps">
    <div class="step"><span class="n">1</span><div class="ic">🎟️</div><b>Crea tu sorteo</b><p>Introduce número, serie y valor. Obtienes un panel privado solo para tu sorteo.</p></div>
    <div class="step"><span class="n">2</span><div class="ic">📤</div><b>Comparte el enlace</b><p>Envías el enlace a quien quiera entrar. Cada uno pone su importe, sin ver a los demás.</p></div>
    <div class="step"><span class="n">3</span><div class="ic">📲</div><b>Reparte comprobantes</b><p>Cada partícipe recibe su imagen con QR y su PDF. Se guardan y se comparten por WhatsApp.</p></div>
  </div>
</section>

<section>
  <p class="sec-tag">Lo que obtienes</p>
  <h2 class="sec">El comprobante de cada partícipe</h2>
  <p class="sec-sub">Imagen + PDF, con QR que abre la verificación pública (anónima).</p>
  <div class="mock-wrap">
    <div class="mock">
      <div class="head"><div class="num">85432</div><div class="serie">serie 021</div></div>
      <div class="row"><span>Participante</span><b>Ana</b></div>
      <div class="row"><span>Aportación</span><b>10,00 €</b></div>
      <div class="row"><span>% del premio</span><b>50%</b></div>
      <div class="row"><span>Estado</span><b style="color:var(--ok)">✓ válido</b></div>
      <div class="qr">QR</div>
    </div>
    <div class="mock-cap">
      <p style="margin-top:0">Cada comprobante incluye:</p>
      <ul>
        <li>Número, serie y nombre del sorteo.</li>
        <li>Tu nombre, tu importe y tu <b>% del premio</b>.</li>
        <li>Un <b>QR</b> que abre la verificación pública del sorteo.</li>
        <li>Tu <b>PDF legal</b> con firma del partícipe y del organizador.</li>
        <li>Un <b>enlace privado</b> solo tuyo (no se vuelve a mostrar a nadie).</li>
      </ul>
      <p style="margin-bottom:0">El enlace del comprobante usa un <b>código secreto de 256 bits</b>: imposible de adivinar, y no existe otra forma de verlo.</p>
    </div>
  </div>
</section>

<section>
  <p class="sec-tag">Por qué</p>
  <h2 class="sec">Honestidad y privacidad, por diseño</h2>
  <p class="sec-sub">Nada de depender de "la palabra del organizador".</p>
  <div class="feats">
    <div class="feat"><div class="ic">🔗</div><div><b>Integridad verificable</b><p>Cada aportación se encadena con un hash. Si alguien toca un importe después, la verificación pública lo detecta y lo marca como alterado.</p></div></div>
    <div class="feat"><div class="ic">🔒</div><div><b>Comprobante privado</b><p>Cada participante ve solo su parte. No hay listas públicas con nombres e importes.</p></div></div>
    <div class="feat"><div class="ic">🕵️</div><div><b>Verificación anónima</b><p>La página pública de verificación muestra solo total, saldo y estado. Nunca quién puso cuánto.</p></div></div>
    <div class="feat"><div class="ic">📄</div><div><b>Documento con base legal</b><p>El PDF referencia la comunidad de bienes (Código Civil) y el reparto proporcional del premio.</p></div></div>
    <div class="feat"><div class="ic">🛡️</div><div><b>Anti-fuerza bruta</b><p>Accesos a comprobantes con límite por IP y registro. Los intentos de adivinar quedan detectados.</p></div></div>
    <div class="feat"><div class="ic">🧾</div><div><b>Reparto claro</b><p>Cada partícipe ve su % exacto del premio. Si toca, cada uno sabe lo que le corresponde.</p></div></div>
  </div>
</section>

<section id="metodo">
  <p class="sec-tag">Metodología</p>
  <h2 class="sec">Cómo funciona por dentro, sin letra pequeña</h2>
  <p class="sec-sub">Aquí no ocultamos nada. Esto es lo que hace el sistema, qué garantiza y qué no.</p>
  <div class="feats">
    <div class="feat"><div class="ic">🔗</div><div><b>Cadena de hashes (SHA-256)</b><p>Cada aportación guarda <code>hash_actual = SHA256(hash_anterior | sorteo | importe | timestamp)</code>. Cada bloque apunta al anterior. Es la misma función hash que usa TLS/Node nativo — no es un sistema inventado ni una blockchain.</p></div></div>
    <div class="feat"><div class="ic">🛡️</div><div><b>Detección de manipulación</b><p>Si alguien toca un importe en la base de datos, el hash deja de cuadrar con el siguiente y la verificación pública marca el sorteo como ALTERADO. Está demostrado por un test automatizado que cambia un importe y comprueba que se rompe.</p></div></div>
    <div class="feat"><div class="ic">🔒</div><div><b>Comprobante por token secreto</b><p>Cada partícipe accede a su comprobante con un código de 256 bits generado al azar. No se puede adivinar ni enumerar. El identificador interno de la base de datos nunca se expone en una URL pública.</p></div></div>
    <div class="feat"><div class="ic">🕵️</div><div><b>Privacidad por diseño</b><p>El partícipe ve solo su comprobante. La verificación pública muestra únicamente total, saldo y estado de la cadena — nunca nombres ni importes individuales. Solo el organizador ve a los partícipes de SU sorteo.</p></div></div>
    <div class="feat"><div class="ic">📄</div><div><b>Documento con base legal</b><p>El PDF incluye tu nombre, tu aportación, tu % del premio y referencia a la comunidad de bienes (Código Civil), con firma del partícipe y del organizador.</p></div></div>
    <div class="feat"><div class="ic">🛡️</div><div><b>Anti-fuerza bruta</b><p>Accesos a comprobantes con límite por IP (20 intentos fallidos / 10 min) y registro en log. Un intento de adivinar tokens queda detectado.</p></div></div>
  </div>
</section>

<section id="honestidad" style="padding-top:0">
  <p class="sec-tag">Transparencia</p>
  <h2 class="sec">Qué garantiza esto — y qué no</h2>
  <div class="feats" style="grid-template-columns:1fr 1fr">
    <div class="feat" style="border-color:rgba(52,211,153,.3)"><div class="ic">✅</div><div><b>Garantiza</b><p style="margin-bottom:4px">· Que los importes registrados no se alteran después de emitirse (hash encadenado).<br>· Que cada comprobante es privado y solo accesible con su token.<br>· Que cada partícipe tiene su % exacto del reparto por escrito.</p></div></div>
    <div class="feat" style="border-color:rgba(248,113,113,.3)"><div class="ic">⚠️</div><div><b>No garantiza</b><p style="margin-bottom:0">· Que el boleto o premio físico exista: eso depende del organizador, que es quien lo deposita.<br>· La identidad real de los partícipes (se registra el nombre que se declara).<br>· Que sea una blockchain descentralizada: es una base SQLite con hashes, suficiente para este uso.</p></div></div>
  </div>
</section>

<footer>
  <b>Participaciones de sorteos con comprobante</b> · Cualquier evento: sorteos, rifas, apuestas, solidario<br>
  <a href="#crear">Crear sorteo</a> · <a href="#metodo">Metodología</a> · <a href="mailto:info@viajeinteligencia.com">info@viajeinteligencia.com</a><br>
  <span style="font-size:11.5px;opacity:.75">versión 0.2.0 · Open source · Los servidores los paga su autor</span>
</footer>
</div>
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
  <h1>🎟️ Participa en el décimo ${esc(d.numero)} · ${esc(d.serie)}</h1>
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
