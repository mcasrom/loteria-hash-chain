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
:root{--bg:#0f172a;--card:#1e293b;--line:#334155;--fg:#e2e8f0;--mut:#94a3b8;--accent:#2563eb;--accent2:#3b82f6;--ok:#4ade80;--err:#f87171;--line2:#475569;--bg2:#111c34}
[data-theme="light"]{--bg:#f6f8fc;--card:#ffffff;--line:#dde4f0;--fg:#16213a;--mut:#5b6b85;--accent:#2563eb;--accent2:#2563eb;--ok:#16a34a;--err:#dc2626;--line2:#dbe3f0;--bg2:#f1f5fb}
*{box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:24px;line-height:1.5}
main{max-width:680px;margin:0 auto}
h1{font-size:26px;margin:0 0 4px}.muted{color:var(--mut);font-size:13px;margin:2px 0}
.mono{font-family:monospace;font-size:11px;color:var(--mut)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;margin:18px 0}
.badge{padding:4px 12px;border-radius:20px;font-weight:700;font-size:12px;white-space:nowrap}
.ok{background:#052e16;color:#4ade80}.bad{background:#450a0a;color:#f87171}
[data-theme="light"] .ok{background:#dcfce7;color:#166534}[data-theme="light"] .bad{background:#fee2e2;color:#991b1b}
.kpis{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
.kpi{flex:1;min-width:100px;background:var(--bg);border-radius:10px;padding:10px 14px;text-align:center}
.kpi b{display:block;font-size:18px}.kpi span{font-size:11px;color:var(--mut)}
.bar{height:8px;background:var(--line);border-radius:4px;overflow:hidden;margin:6px 0 16px}
.bar>div{height:100%;background:linear-gradient(90deg,#2563eb,#4ade80);border-radius:4px}
table{width:100%;border-collapse:collapse;font-size:14px;margin-bottom:8px}
td,th{padding:8px;border-bottom:1px solid var(--line);text-align:left}
th{color:var(--mut);font-weight:600;font-size:12px}
.del-btn{background:transparent;border:1px solid var(--line);color:#f87171;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:14px}
.del-btn:hover{background:rgba(248,113,113,.15);border-color:#f87171}
.share-btn{background:transparent;border:1px solid var(--line);color:var(--accent);width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:14px}
.share-btn:hover{background:rgba(59,130,246,.15);border-color:var(--accent)}
.join{background:var(--bg);border:1px dashed var(--line);border-radius:12px;padding:16px;margin-top:12px}
.join-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.join input{flex:1;min-width:120px;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);font-size:14px}
.join button{background:var(--accent);color:#fff;border:none;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer}
.msg{font-size:13px;margin-top:8px}.msg.ok{color:#4ade80}.msg.err{color:#f87171}
a{color:#60a5fa}
[data-theme="light"] a{color:#2563eb}
.btn{display:inline-block;background:var(--accent);color:#fff;padding:11px 18px;border-radius:8px;font-weight:700;text-decoration:none}
.btn:hover{filter:brightness(1.1)}
.btn-line{display:inline-block;padding:11px 18px;border-radius:8px;font-weight:700;text-decoration:none;border:1px solid var(--accent);color:var(--accent);background:transparent}
.btn-line:hover{background:var(--bg2)}
.theme-btn{background:var(--card);border:1px solid var(--line);color:var(--fg);width:36px;height:36px;border-radius:9px;cursor:pointer;font-size:16px;margin-right:10px}
</style>`;

// 1. Raíz: landing completa y pulida (genérica para cualquier sorteo)
router.get('/', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Registro verificable de participaciones</title>
<meta name="description" content="Deja constancia de quién participa en un sorteo, boleto o reparto compartido, cuánto aporta y qué porcentaje le corresponde. Cada partícipe recibe un comprobante privado con QR y PDF.">
<meta property="og:title" content="Registro verificable de participaciones">
<meta property="og:description" content="Comparte una participación en un sorteo. Deja el reparto por escrito. Comprobantes privados con QR y PDF.">
<meta property="og:image" content="${baseUrl}/assets/og-preview.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${baseUrl}/">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<link rel="manifest" href="/assets/manifest.webmanifest">
<meta name="theme-color" content="#0a0f1e">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Participaciones">
<link rel="apple-touch-icon" href="/assets/icon-192.png">
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
.hm{display:none !important;position:fixed !important;inset:0 !important;z-index:9999 !important;background:rgba(0,0,0,.75) !important;backdrop-filter:blur(6px) !important;align-items:center !important;justify-content:center !important;padding:20px !important}
.hm.show{display:flex !important}
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
  <h1>Comparte una participación. Deja el reparto por escrito.</h1>
  <p>Si ya tienes un décimo, una rifa, una apuesta o un bote compartido, registra quién participa, cuánto aporta y qué porcentaje del reparto le corresponde. Cada partícipe recibe un <b>comprobante privado</b> con QR y PDF.</p>
  <p class="resp">La herramienta no crea sorteos, no vende boletos, no custodia dinero y no garantiza resultados: documenta el acuerdo entre las personas participantes.</p>
  <div class="sub-badges"><span>🔗 Registro verificable</span><span>🔒 Comprobantes privados</span><span>📄 PDF de constancia</span><span>📱 Fácil de compartir</span></div>
  <div class="cta-row">
    <a class="cta" href="#registrar">🎟️ Crear registro de participaciones</a>
    <a class="cta2" href="javascript:void(0)" onclick="openWelcome()">✨ Qué te ofrecemos</a>
    <a class="cta2" href="#como">Ver un ejemplo</a>
  </div>
</header>

<section id="registrar">
  <div class="form-shell">
    <h3>🎟️ Registra un sorteo o reparto compartido</h3>
    <p class="hint">Añade los datos del boleto, rifa o reparto que ya existe. Después invita a las personas participantes.</p>
    <form id="form-crear" method="POST" action="/decimos">
      <div class="grid2">
        <input name="numero" id="inp-numero" placeholder="Número (si lo hay, ej. 85432)">
        <input name="serie" id="inp-serie" placeholder="Serie (si lo hay)">
        <input name="sorteo" placeholder="Nombre del sorteo o reparto" value="Sorteo compartido">
        <input name="valor_total" id="inp-valor" type="number" step="0.01" min="1" value="20" placeholder="Importe de referencia €" >
      </div>
      <button class="btn-big" type="submit">🎟️ Crear el registro de participaciones</button>
    </form>
    <p id="form-aviso" style="display:none;margin-top:12px;padding:10px 14px;border-radius:10px;font-size:14px"></p>
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
  <span style="font-size:11.5px;opacity:.75">versión 1.0.0 · Proyecto independiente y de código abierto</span><br>
  <a href="https://github.com/mcasrom/loteria-hash-chain" target="_blank" rel="noopener noreferrer"
     style="display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:12.5px;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 14px;margin-top:10px;text-decoration:none;opacity:.85">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
    Código abierto en GitHub
  </a><br>
  <a href="#registrar">Crear un registro</a> · <a href="#como">Cómo funciona</a> · <a href="#confianza">Privacidad y seguridad</a><br>
  <a href="https://ko-fi.com/m_castillo" target="_blank" rel="noopener noreferrer"
     style="display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:13.5px;color:#fff;background:#13C3A5;border-radius:7px;padding:11px 18px;margin-top:6px;text-decoration:none">☕ Invítame a un café</a>
</footer>
</div>

<!-- MODAL: Bienvenida + funnel -->
<div id="welcome-modal" class="hm" onclick="if(event.target===this)closeWelcome()">
<div style="background:#070b18;border:1px solid #1c2a47;border-radius:24px;max-width:520px;width:100%;padding:36px 32px 30px;position:relative;box-shadow:0 30px 90px rgba(0,0,0,.6);text-align:center">
  <button onclick="closeWelcome()" style="position:absolute;top:14px;right:14px;background:transparent;border:none;color:#8ba0c4;font-size:20px;cursor:pointer;width:32px;height:32px;border-radius:8px">✕</button>
  <div style="font-size:48px;margin-bottom:12px">🎟️</div>
  <h2 style="margin:0 0 8px;font-size:24px;color:#e8eefb;line-height:1.3">Comparte una participación.<br><span style="color:#f59e0b">Deja el reparto por escrito.</span></h2>
  <p style="color:#8ba0c4;font-size:15px;margin:0 0 22px;line-height:1.6">Si ya tienes un décimo, una rifa o un bote compartido, registra quién participa, cuánto aporta y qué porcentaje le corresponde.</p>
  <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:24px">
    <span style="background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.25);color:#34d399;font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:20px">✓ Gratis</span>
    <span style="background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.25);color:#60a5fa;font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:20px">🔒 Privado</span>
    <span style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);color:#fbbf24;font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:20px">🔗 Verificable</span>
    <span style="background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.25);color:#a78bfa;font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:20px">📄 PDF</span>
  </div>
  <a href="#registrar" onclick="closeWelcome()" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#3b82f6);color:#fff;padding:15px 36px;border-radius:12px;font-weight:800;font-size:16px;text-decoration:none;box-shadow:0 8px 30px rgba(37,99,235,.4)">🎟️ Crear mi registro</a>
  <p style="color:#5b6b85;font-size:12px;margin:16px 0 0">Sin cuentas · Sin custodiar dinero · Cada uno recibe su comprobante privado</p>
</div>
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
function openWelcome(){var m=document.getElementById('welcome-modal');if(m)m.classList.add('show');}
function closeWelcome(){var m=document.getElementById('welcome-modal');if(m)m.classList.remove('show');}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeWelcome();});
// Auto-abre el popup de bienvenida en CADA carga de la landing (sin supresión
// persistente): es el funnel de enganche. El usuario lo cierra con X/Escape/clic fuera.
setTimeout(openWelcome,900);
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function(){ navigator.serviceWorker.register('/assets/sw.js'); });
}
(function(){
  var form = document.getElementById('form-crear');
  if (!form) return;
  var aviso = document.getElementById('form-aviso');
  function mostrarAviso(msg, tipo){
    aviso.style.display = 'block';
    aviso.textContent = msg;
    aviso.style.background = tipo === 'err' ? 'rgba(248,113,113,.15)' : 'rgba(52,211,153,.12)';
    aviso.style.color = tipo === 'err' ? '#f87171' : '#4ade80';
    aviso.style.border = '1px solid ' + (tipo === 'err' ? 'rgba(248,113,113,.4)' : 'rgba(52,211,153,.4)');
  }
  form.addEventListener('submit', function(ev){
    ev.preventDefault();
    var numero = document.getElementById('inp-numero').value.trim();
    var serie = document.getElementById('inp-serie').value.trim();
    var valor = parseFloat(document.getElementById('inp-valor').value);
    // Aviso suave si no hay número ni serie: se puede continuar, solo informa.
    if (!numero && !serie) {
      if (!confirm('No has indicado número ni serie del sorteo. ¿El reparto es sin número conocido?\\n\\n[OK] Continuar sin número\\n[Cancelar] Volver a revisar')) return;
    } else if (!numero) {
      if (!confirm('No has indicado el número. ¿Continuar sin número?\\n\\n[OK] Continuar\\n[Cancelar] Revisar')) return;
    }
    if (!isFinite(valor) || valor <= 0) {
      mostrarAviso('⚠️ Introduce un importe total válido (mayor que 0).', 'err');
      return;
    }
    // Enviar el form de verdad (submit nativo) para crear el reparto.
    form.submit();
  });
})();
</script>
</body></html>`);
});

// POST crear reparto (número y serie opcionales — son "si lo hay")
router.post('/decimos', (req, res) => {
  const numero = String(req.body.numero || '').trim();
  const serie = String(req.body.serie || '').trim();
  const sorteo = String(req.body.sorteo || 'Sorteo compartido').trim();
  const valor_total = parseFloat(req.body.valor_total);
  // Solo el importe total es imprescindible. Número/serie son opcionales.
  if (!isFinite(valor_total) || valor_total <= 0)
    return res.status(400).send('Error: falta el importe total del reparto');
  const id = crypto.randomUUID();
  const organizadorToken = crypto.randomBytes(32).toString('hex'); // 256 bits, secreto del creador
  db.prepare('INSERT INTO decimos (id, organizador_id, organizador_token, numero, serie, sorteo, valor_total, created_at, estado) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, null, organizadorToken, numero || '—', serie || '—', sorteo, valor_total, new Date().toISOString(), 'abierto');
  res.redirect(303, `/gestion/${organizadorToken}`);
});

// 2. Panel del ORGANIZADOR (solo su número)
// /decimo/:id ya NO es el panel (antes exponía datos del creador con el id público).
// Redirige a la verificación pública anónima para enlaces antiguos.
router.get('/decimo/:id', (req, res) => {
  const d = db.prepare('SELECT id FROM decimos WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).send('Décimo no encontrado');
  res.redirect(301, `/verificar/${d.id}`);
});

router.get('/gestion/:token', (req, res) => {
  const d = db.prepare('SELECT * FROM decimos WHERE organizador_token = ?').get(req.params.token);
  if (!d) return res.status(404).send('Acceso de gestión no encontrado. Revisa tu enlace privado.');
  const chain = computeChain(db, d.id);
  const agg = resumen(d.id);
  const parts = db.prepare('SELECT id, importe, nombre_participante, access_token, modalidad, importe_aportado, valor_referencia, aceptado_at FROM participaciones WHERE decimo_id = ? ORDER BY created_at ASC').all(d.id);
  const enlaceParticipar = `${base(req)}/participa/${d.id}`;
  const enlaceGestion = `${base(req)}/gestion/${d.organizador_token}`;
  const enlaceVerificar = `${base(req)}/verificar/${d.id}`;
  const pct = d.valor_total > 0 ? Math.min(100, (agg.s / d.valor_total) * 100) : 0;
  const saldo = d.valor_total - agg.s;
  const pctRegistrado = d.valor_total > 0 ? ((agg.s / d.valor_total) * 100).toFixed(1) : '0';
  const cerrado = d.estado === 'cerrado';

  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Décimo ${d.numero} · gestión</title>${css}</head><body>
<main>
<p class="muted"><a href="javascript:history.back()">← Volver</a> · <a href="/">🏠 Inicio</a></p>

<div class="card" style="border-color:var(--accent2)">
  <h2 style="margin-top:0">🔐 Acceso privado del creador</h2>
  <p class="muted">Guarda este enlace: es tu acceso permanente para consultar y administrar este reparto. Por seguridad, no se vuelve a mostrar automáticamente.</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0">
    <input readonly value="${enlaceGestion}" style="flex:1;min-width:200px;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font-size:13px">
    <button class="btn" onclick="copyTexto('${enlaceGestion}')">📋 Copiar enlace</button>
    <button class="btn" onclick="window.open('mailto:?subject=Acceso a tu reparto&amp;body=Tu enlace de gestión: ${encodeURIComponent(enlaceGestion)}','_self')">✉️ Enviar a mi correo</button>
    <button class="btn" onclick="descargarRecuperacion('${d.id}','${enlaceGestion}')">⬇️ Código de recuperación</button>
  </div>
  <p class="muted" style="margin:0">Desde aquí puedes ver el estado, completar participaciones, compartir enlaces y cerrar el reparto.</p>
</div>

<div class="card">
  <div class="card-head" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
    <div><h1 style="margin:0">Reparto ${esc(d.numero)} · ${esc(d.serie)}</h1>
    <p class="muted">${esc(d.sorteo)} · Panel <b>solo tuyo</b></p></div>
    <span class="badge ${cerrado ? 'bad' : 'ok'}">${cerrado ? '🔒 CERRADO' : '● ABIERTO'}</span>
    <span class="badge ${chain.ok ? 'ok' : 'bad'}">Integridad: ${chain.ok ? 'VERIFICADA ✓' : 'ALTERADA ✗'}</span>
  </div>
  <div class="kpis">
    <div class="kpi"><b>${d.valor_total.toFixed(2)}€</b><span>importe total</span></div>
    <div class="kpi"><b>${agg.s.toFixed(2)}€</b><span>registrado</span></div>
    <div class="kpi"><b>${pctRegistrado}%</b><span>asignado</span></div>
    <div class="kpi"><b>${agg.c}</b><span>participaciones</span></div>
    <div class="kpi"><b>${saldo.toFixed(2)}€</b><span>pendiente</span></div>
  </div>
  <div class="bar"><div style="width:${pct}%"></div></div>
  <p class="muted">Participaciones: <b>${agg.c}</b> registradas · Importe registrado: <b>${agg.s.toFixed(2)}€</b> · Pendiente: <b>${saldo.toFixed(2)}€ / ${(100-pct).toFixed(0)}%</b></p>
  ${cerrado ? `<p class="muted" style="color:var(--ok)">Este reparto está cerrado. No se pueden añadir más participaciones.</p>${d.firmado_org_at ? `<p class="muted" style="font-size:12px;color:var(--ok)">✓ Firma del organizador registrada: ${esc(d.firmado_org_at)} (al cerrar el reparto).</p>` : ''}` : ''}
</div>

<div class="card">
<h2>🔗 Enlaces del reparto</h2>
<p class="muted" style="margin:0 0 10px">Tres enlaces diferenciados según a quién van destinados:</p>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
  <button class="btn" onclick="copyTexto('${enlaceParticipar}')">📤 Enlace de participación</button>
  <button class="btn" onclick="window.open('https://wa.me/?text='+encodeURIComponent('Regístrate en este reparto: ${enlaceParticipar}'),'_blank')">📲 Compartir participación (WhatsApp)</button>
  <a class="btn-line" href="${enlaceVerificar}" target="_blank">🔍 Verificación pública</a>
</div>
<p class="muted" style="font-size:12px">· <b>Enlace de participación</b>: lo comparten con las personas invitadas.<br>· <b>Verificación pública</b>: para QR/PDF/terceros, sin datos privados.</p>
</div>

<div class="card">
<h2>Participaciones de TU reparto (${parts.length})</h2>
${parts.length ? `<table><tr><th>Partícipe</th><th>Modalidad</th><th>Cuota</th><th>% reparto</th><th>Comprobante</th><th>Compartir</th><th></th></tr>
${parts.map((p, i) => {
  const esUltima = i === parts.length - 1;
  const linkPart = `${base(req)}/mi-participacion/${p.access_token}`;
  const pctP = d.valor_total > 0 ? ((p.importe / d.valor_total) * 100).toFixed(2) : '0';
  const modLabel = p.modalidad === 'gratuita' ? 'regalo' : 'aportada';
  const aceptada = p.aceptado_at ? '✓ aceptó' : '⏳ sin aceptar';
  const detalle = p.modalidad === 'gratuita' ? `0€ (ref ${p.importe.toFixed(2)}€)` : `${(p.importe_aportado != null ? p.importe_aportado : p.importe).toFixed(2)}€`;
  return `<tr><td>${esc(p.nombre_participante) || 'Anónimo'}<br><span class="muted" style="font-size:11px">${aceptada}</span></td><td>${modLabel}</td><td>${detalle}</td><td>${pctP}%</td>
<td class="mono"><a href="${linkPart}" target="_blank">abrir</a></td>
<td><button class="share-btn" onclick="compartir('${linkPart}','${esc(p.nombre_participante) || 'tu'}','${d.id}')">📤</button></td>
<td>${esUltima ? `<button class="del-btn" onclick="eliminarUltima('${d.id}','${d.organizador_token}')" title="Eliminar la última participación (si hubo un error)">🗑</button>` : ''}</td></tr>`;
}).join('')}</table>
<p class="muted" style="font-size:12px">📤 Compartir copia el enlace del comprobante o lo abre en WhatsApp. 🗑 Solo se puede eliminar la <b>última</b> participación (corrige errores).</p>`
  : '<p class="muted">Aún no hay participaciones.</p>'}
</div>
${cerrado ? '' : `<div class="card">
<h2>➕ Añadir una participación</h2>
<form class="join" data-decimo="${d.id}">
  <div class="join-row" style="margin-bottom:8px">
    <label style="font-size:13px;color:var(--mut)">Modalidad:</label>
    <label style="font-size:13px"><input type="radio" name="modalidad" value="aportada" checked onchange="toggleModalidad()"> Aportada (pagó)</label>
    <label style="font-size:13px"><input type="radio" name="modalidad" value="gratuita" onchange="toggleModalidad()"> Gratuita (regalo)</label>
  </div>
  <div class="join-row">
    <input name="nombre" placeholder="Nombre del partícipe" >
    <input name="importe" type="number" step="0.01" min="0" max="${saldo > 0 ? saldo : 0}" placeholder="Importe €" >
    <button>Añadir</button>
  </div>
  <p class="msg"></p>
  <p class="muted" id="mod-hint" style="font-size:12px;margin:4px 0 0">Modalidad <b>aportada</b>: el partícipe entrega dinero y recibe una cuota.</p>
</form>
</div>`}
<div class="card" style="text-align:center">
  <button class="btn" onclick="descargarResumen('${d.id}','${d.organizador_token}')">📄 Descargar resumen</button>
  ${cerrado ? '' : `<button class="btn" style="background:#dc2626" onclick="cerrarReparto('${d.id}','${d.organizador_token}')">🔒 Cerrar y sellar el reparto</button>`}
</div>
</main>
<script>
document.querySelector('.join') && document.querySelector('.join').addEventListener('submit', async function(ev){
  ev.preventDefault();
  var form=ev.target, did=form.dataset.decimo;
  var nombre=form.querySelector('[name=nombre]').value;
  var importeEl=form.querySelector('[name=importe]');
  var importeVal=importeEl?importeEl.value.trim():'';
  var msg=form.querySelector('.msg'); msg.className='msg'; msg.textContent='Generando tu comprobante...';
  var body={nombre:nombre};
  if(importeVal===''){body.modalidad='gratuita';}
  else{body.modalidad='aportada';body.importe=parseFloat(importeVal);}
  var r=await fetch('/decimos/'+did+'/participaciones',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  var data=await r.json();
  if(!r.ok){msg.className='msg err';msg.textContent=data.message||data.error;return;}
  msg.className='msg ok';
  msg.innerHTML='✓ Comprobante: <a href="/mi-participacion/'+data.access_token+'">ver / enviar</a>';
  setTimeout(function(){location.reload();},1800);
});
function toggleModalidad(){
  var f=document.querySelector('.join'); if(!f) return;
  var m=f.querySelector('input[name=modalidad]:checked').value;
  var hint=document.getElementById('mod-hint');
  var importe=f.querySelector('[name=importe]');
  if(m==='gratuita'){
    importe.placeholder="Importe € (opcional)";
    if(hint) hint.innerHTML='Modalidad <b>gratuita</b>: asignas una cuota del décimo sin que el partícipe pague nada. Se registra "importe aportado 0 €" y un valor de referencia.';
  } else {
    importe.placeholder='Importe €';
    if(hint) hint.innerHTML='Modalidad <b>aportada</b>: el partícipe entrega dinero y recibe una cuota.';
  }
}
function compartir(link, nombre, did){
  var texto = '🎟️ Tu participación está registrada. Abre tu comprobante aquí: ' + link;
  var op = confirm('Compartir con ' + nombre + ':\\n\\n[OK] Copiar enlace\\n[Cancelar] Abrir WhatsApp con el mensaje listo');
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
async function eliminarUltima(did, tok){
  if(!confirm('¿Eliminar la última participación? Esta acción no se puede deshacer. La cadena de integridad se mantiene (solo se quita la última).')) return;
  var r=await fetch('/decimos/'+did+'/participaciones/ultima',{method:'DELETE',headers:{'X-Organizador-Token':tok}});
  var data=await r.json();
  if(!r.ok){alert(data.message||data.error);return;}
  alert('Participación eliminada: '+(data.eliminada.nombre||'Anónimo')+' ('+data.eliminada.importe.toFixed(2)+'€)');
  location.reload();
}
function copyTexto(txt){
  (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
    .then(function(){ alert('Enlace copiado al portapapeles'); })
    .catch(function(){ prompt('Copia este enlace:', txt); });
}
function descargarRecuperacion(id, enlace){
  var txt = 'REGISTRO DE PARTICIPACIONES - CÓDIGO DE RECUPERACIÓN\\n\\nID del reparto: ' + id + '\\nEnlace de gestión: ' + enlace + '\\n\\nGuárdalo en lugar seguro. Este enlace es tu acceso privado para gestionar el reparto.\\n';
  var blob = new Blob([txt], {type:'text/plain'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'recuperacion-reparto-' + id.slice(0,8) + '.txt';
  a.click();
  alert('Código de recuperación descargado. Guárdalo en lugar seguro.');
}
function descargarResumen(did, tok){
  window.open('/gestion/'+tok+'/resumen.txt','_blank');
}
async function cerrarReparto(did, tok){
  if(!confirm('¿Cerrar y sellar el reparto? No se podrán añadir más participaciones. Esta acción se puede deshacer abriéndolo de nuevo.')) return;
  var r=await fetch('/decimos/'+did+'/cerrar',{method:'POST',headers:{'X-Organizador-Token':tok}});
  var data=await r.json();
  if(!r.ok){alert(data.error||'Error');return;}
  location.reload();
}
(function(){
  var root=document.documentElement;
  var btn=document.createElement('button');
  btn.className='theme-btn'; btn.title='Cambiar tema';
  btn.style.cssText='position:fixed;top:14px;right:14px;z-index:50;';
  document.body.appendChild(btn);
  function apply(t){ if(t==='light'){root.setAttribute('data-theme','light');btn.textContent='☀️';} else {root.removeAttribute('data-theme');btn.textContent='🌙';} }
  var saved='dark'; try{ saved=localStorage.getItem('tema')||'dark'; }catch(e){}
  apply(saved==='light'?'light':'dark');
  btn.onclick=function(){ var cur=root.getAttribute('data-theme')==='light'?'dark':'light'; apply(cur); try{localStorage.setItem('tema',cur);}catch(e){} };
})();
</script>
<div style="text-align:center;margin-top:20px;padding:10px 0">
  <a href="https://ko-fi.com/m_castillo" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:13.5px;color:#fff;background:#13C3A5;border-radius:7px;padding:11px 18px;text-decoration:none">☕ Invítame a un café</a>
</div>
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
<p class="muted"><a href="javascript:history.back()">← Volver</a> · <a href="/">🏠 Inicio</a></p>
<div class="card">
  <h1>🎟️ Participa en ${esc(d.numero)} · ${esc(d.serie)}</h1>
  <p class="muted">${esc(d.sorteo)}</p>
  <div class="kpis">
    <div class="kpi"><b>${d.valor_total.toFixed(2)}€</b><span>total</span></div>
    <div class="kpi"><b>${agg.s.toFixed(2)}€</b><span>ya aportado</span></div>
    <div class="kpi"><b>${saldo.toFixed(2)}€</b><span>disponible</span></div>
  </div>
  <div class="bar"><div style="width:${pct}%"></div></div>
  <p class="muted">Introduce <b>tu nombre</b>. Si es aportada, indica la cantidad. No ves quién más participa. Al aportar recibes tu comprobante personal.</p>
  ${saldo > 0 ? `<form class="join" data-decimo="${d.id}">
    <div class="join-row" style="margin-bottom:8px">
      <label style="font-size:13px;color:var(--mut)">Modalidad:</label>
      <label style="font-size:13px"><input type="radio" name="modalidad" value="aportada" checked onchange="toggleModalidad()"> Aportada (pagó)</label>
      <label style="font-size:13px"><input type="radio" name="modalidad" value="gratuita" onchange="toggleModalidad()"> Gratuita (regalo)</label>
    </div>
    <div class="join-row">
      <input name="nombre" placeholder="Tu nombre" >
      <input name="importe" type="number" step="0.01" min="0" max="${saldo}" placeholder="Importe € o Regalo" id="inp-importe">
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
  var importeEl=form.querySelector('[name=importe]');
  var importeVal=importeEl?importeEl.value.trim():'';
  var msg=form.querySelector('.msg'); msg.className='msg'; msg.textContent='Generando tu comprobante...';
  var body={nombre:nombre};
  if(importeVal===''){body.modalidad='gratuita';}
  else{body.modalidad='aportada';body.importe=parseFloat(importeVal);}
  var r=await fetch('/decimos/'+did+'/participaciones',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  var data=await r.json();
  if(!r.ok){msg.className='msg err';msg.textContent=data.message||data.error;return;}
  msg.className='msg ok';
  msg.innerHTML='✓ Aportación registrada. <a href="/mi-participacion/'+data.access_token+'"><b>Ver y descargar TU comprobante →</b></a>';
});
(function(){
  var root=document.documentElement;
  var btn=document.createElement('button');
  btn.className='theme-btn'; btn.title='Cambiar tema';
  btn.style.cssText='position:fixed;top:14px;right:14px;z-index:50;';
  document.body.appendChild(btn);
  function apply(t){ if(t==='light'){root.setAttribute('data-theme','light');btn.textContent='☀️';} else {root.removeAttribute('data-theme');btn.textContent='🌙';} }
  var saved='dark'; try{ saved=localStorage.getItem('tema')||'dark'; }catch(e){}
  apply(saved==='light'?'light':'dark');
  btn.onclick=function(){ var cur=root.getAttribute('data-theme')==='light'?'dark':'light'; apply(cur); try{localStorage.setItem('tema',cur);}catch(e){} };
})();
</script>
<div style="text-align:center;margin-top:20px;padding:10px 0">
  <a href="https://ko-fi.com/m_castillo" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:13.5px;color:#fff;background:#13C3A5;border-radius:7px;padding:11px 18px;text-decoration:none">☕ Invítame a un café</a>
</div>
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
  const esGratuita = p.modalidad === 'gratuita';
  const importeMostrado = esGratuita ? (p.importe_aportado != null ? p.importe_aportado : 0) : (p.importe_aportado != null ? p.importe_aportado : p.importe);
  const yaAceptada = Boolean(p.aceptado_at);

  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Tu comprobante · ${d.numero}</title>${css}</head><body>
<main>
<p class="muted"><a href="javascript:history.back()">← Volver</a> · <a href="/">🏠 Inicio</a></p>
<div class="card">
  <span class="badge ${chain.ok ? 'ok' : 'bad'}" style="margin-bottom:10px">Cadena del décimo: ${chain.ok ? 'ÍNTEGRA ✓' : 'ALTERADA ✗'}</span>
  <h1 style="margin:10px 0 4px">Tu participación</h1>
  <p class="muted">Comprobante personal. Solo quien tenga este enlace lo ve.</p>
  <div class="kpis">
    <div class="kpi"><b>${esc(d.numero)}</b><span>serie ${esc(d.serie)}</span></div>
    <div class="kpi"><b>${esGratuita ? '0,00' : importeMostrado.toFixed(2)}€</b><span>tu aportación</span></div>
    <div class="kpi"><b>${pct}%</b><span>de participación</span></div>
    <div class="kpi"><b>${esc(p.nombre_participante) || 'Anónimo'}</b><span>partícipe</span></div>
  </div>
  ${esGratuita ? `<p class="muted" style="font-size:13px">Modalidad: <b>asignación gratuita</b> — te han regalado una cuota (valor de referencia ${p.importe.toFixed(2)}€). No has aportado dinero.</p>` : ''}
  ${yaAceptada
    ? `<p class="muted" style="font-size:13px;color:var(--ok)">✓ Aceptación registrada: ${esc(p.aceptado_at)} (enlace privado + confirmación).</p>`
    : `<div class="card" style="border-color:var(--accent2);margin-top:10px">
        <p style="margin:0 0 8px;font-size:14px">Antes de descargar, confirma que has leído y aceptas esta participación.</p>
        <label style="font-size:13px;display:block;margin-bottom:10px"><input type="checkbox" id="chk-acepto"> He leído los datos de esta participación y la acepto.</label>
        <button class="btn" id="btn-aceptar" disabled>✓ Confirmar y aceptar</button>
        <p class="msg" id="msg-acepta" style="margin-top:8px"></p>
      </div>`}
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
    <a href="/mi-participacion/${token}/imagen" class="btn">🖼 Descargar imagen</a>
    <a href="/mi-participacion/${token}/pdf" class="btn">📄 Descargar PDF</a>
    <a href="${linkVerif}" class="btn-line">🔍 Verificar el décimo</a>
  </div>
  <p class="muted" style="margin-top:14px">Comparte tu imagen o PDF por WhatsApp. El QR apunta a tu comprobante privado.</p>
</div>
</main>
<script>
(function(){
  var root=document.documentElement;
  var btn=document.createElement('button');
  btn.className='theme-btn'; btn.title='Cambiar tema';
  btn.style.cssText='position:fixed;top:14px;right:14px;z-index:50;';
  document.body.appendChild(btn);
  function apply(t){ if(t==='light'){root.setAttribute('data-theme','light');btn.textContent='☀️';} else {root.removeAttribute('data-theme');btn.textContent='🌙';} }
  var saved='dark'; try{ saved=localStorage.getItem('tema')||'dark'; }catch(e){}
  apply(saved==='light'?'light':'dark');
  btn.onclick=function(){ var cur=root.getAttribute('data-theme')==='light'?'dark':'light'; apply(cur); try{localStorage.setItem('tema',cur);}catch(e){} };
})();
(function(){
  var chk=document.getElementById('chk-acepto'), b=document.getElementById('btn-aceptar');
  if(!chk||!b) return;
  chk.addEventListener('change', function(){ b.disabled=!chk.checked; });
  b.addEventListener('click', async function(){
    var msg=document.getElementById('msg-acepta');
    msg.className='msg'; msg.textContent='Registrando aceptación...';
    var r=await fetch('/mi-participacion/${token}/aceptar',{method:'POST'});
    var data=await r.json();
    if(!r.ok){ msg.className='msg err'; msg.textContent=data.message||data.error; return; }
    msg.className='msg ok'; msg.textContent='✓ Aceptación registrada. El PDF se ha actualizado.';
    setTimeout(function(){ location.reload(); }, 1500);
  });
})();
</script>
<div style="text-align:center;margin-top:20px;padding:10px 0">
  <a href="https://ko-fi.com/m_castillo" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:13.5px;color:#fff;background:#13C3A5;border-radius:7px;padding:11px 18px;text-decoration:none">☕ Invítame a un café</a>
</div>
</body></html>`);
});

// Resumen descargable del reparto (para el creador)
// Resumen descargable del reparto — SOLO para el creador (valida organizador_token)
router.get('/gestion/:token/resumen.txt', (req, res) => {
  const d = db.prepare('SELECT * FROM decimos WHERE organizador_token = ?').get(req.params.token);
  if (!d) return res.status(404).end();
  const chain = computeChain(db, d.id);
  const agg = resumen(d.id);
  const parts = db.prepare('SELECT nombre_participante, importe FROM participaciones WHERE decimo_id = ? ORDER BY created_at ASC').all(d.id);
  const pct = d.valor_total > 0 ? ((agg.s / d.valor_total) * 100).toFixed(1) : '0';
  let txt = `REPARTO DE PARTICIPACIONES\n`;
  txt += `========================\n\n`;
  txt += `Número: ${d.numero} · Serie: ${d.serie}\n`;
  txt += `Sorteo: ${d.sorteo}\n`;
  txt += `Estado: ${d.estado}\n`;
  txt += `Integridad: ${chain.ok ? 'VERIFICADA' : 'ALTERADA'}\n\n`;
  txt += `Importe total: ${d.valor_total.toFixed(2)} €\n`;
  txt += `Registrado: ${agg.s.toFixed(2)} € (${pct}%)\n`;
  txt += `Pendiente: ${(d.valor_total - agg.s).toFixed(2)} €\n`;
  txt += `Participaciones: ${agg.c}\n\n`;
  txt += `PARTICIPACIONES\n`;
  txt += `--------------\n`;
  if (parts.length) {
    for (const p of parts) {
      const pp = d.valor_total > 0 ? ((p.importe / d.valor_total) * 100).toFixed(2) : '0';
      txt += `${p.nombre_participante || 'Anónimo'}: ${p.importe.toFixed(2)} € (${pp}%)\n`;
    }
  } else {
    txt += `(sin participaciones registradas)\n`;
  }
  txt += `\nVerificación pública: /verificar/${d.id}\n`;
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="resumen-reparto-${d.numero}.txt"`);
  res.send(txt);
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
