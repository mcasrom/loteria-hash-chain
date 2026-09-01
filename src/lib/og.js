// src/lib/og.js
// Genera una imagen Open Graph dinámica (por participación/décimo) con
// número, importe y estado. Respuesta: buffer PNG. No se guarda en disco
// (se genera en cada request), por eso es DINÁMICA, no estática.
const sharp = require('sharp');

async function generarImagenOg({ numero, serie, emitido, valorTotal, n }) {
  const W = 800, H = 600;
  const pct = valorTotal > 0 ? (emitido / valorTotal) * 100 : 0;

  const svg = `
  <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="#0f172a"/>
    <rect x="30" y="30" width="${W-60}" height="${H-60}" rx="20" fill="#1e293b"/>
    <text x="60" y="100" font-family="system-ui" font-size="26" font-weight="bold" fill="#60a5fa">🎄 Lotería Hash-Chain · Verificación</text>
    <text x="60" y="180" font-family="monospace" font-size="90" font-weight="bold" fill="#ffffff">${numero}</text>
    <text x="450" y="180" font-family="monospace" font-size="50" fill="#93c5fd">· ${serie}</text>
    <text x="60" y="260" font-family="system-ui" font-size="24" fill="#94a3b8">${n} participaciones · ${emitido.toFixed(2)}€ de ${valorTotal.toFixed(2)}€ emitidos (${pct.toFixed(0)}%)</text>
    <rect x="60" y="310" width="${W-120}" height="22" rx="11" fill="#334155"/>
    <rect x="60" y="310" width="${(W-120)*pct/100}" height="22" rx="11" fill="#4ade80"/>
    <text x="60" y="380" font-family="system-ui" font-size="30" font-weight="bold" fill="#e2e8f0">Cadena de hashes verificable</text>
    <text x="60" y="420" font-family="system-ui" font-size="18" fill="#64748b">Escanea el QR de tu participación para verificar</text>
  </svg>`;

  return await sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { generarImagenOg };
