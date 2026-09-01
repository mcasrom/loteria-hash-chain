// src/lib/imagen.js
// Genera la imagen de una participación: número, serie, fracción, sorteo,
// importe, nombre del participante y QR que apunta a /verificar/<decimo_id>.
// Usa sharp + qrcode (sin canvas, funciona en Node).
const sharp = require('sharp');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const OUT_IMAGES = path.join(__dirname, '..', '..', 'output-samples', 'imagenes');

async function generarImagen({ participacionId, numero, serie, sorteo, importe, nombre, decimoId, baseUrl, accessToken, modalidad = 'aportada', importeAportado = null }) {
  fs.mkdirSync(OUT_IMAGES, { recursive: true });

  // QR apunta al COMPROBANTE PRIVADO de esta participación (no a la verificación
  // pública): al escanearlo se abre el comprobante de quien lo tiene.
  const url = `${baseUrl}/mi-participacion/${accessToken}`;
  const qrBuf = await QRCode.toBuffer(url, { width: 240, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } });

  const W = 800, H = 1000;
  const esGratuita = modalidad === 'gratuita';
  const importeMostrado = esGratuita ? (importeAportado != null ? importeAportado : 0) : (importeAportado != null ? importeAportado : importe);
  const etiquetaImporte = esGratuita ? 'APORTADO' : 'APORTADO';
  const etiquetaValor = esGratuita ? 'VALOR DE REFERENCIA' : 'VALOR';

  // Fondo
  const fondo = await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 15, g: 23, b: 42 } },
  }).png().toBuffer();

  // SVG overlay con los datos (evita depender de fuentes del sistema en sharp)
  const svg = `
  <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="#0f172a"/>
    <rect x="40" y="40" width="${W-80}" height="${H-80}" rx="24" fill="#1e293b"/>
    <rect x="40" y="40" width="${W-80}" height="120" rx="24" fill="#2563eb"/>
    <text x="80" y="100" font-family="system-ui" font-size="34" font-weight="bold" fill="#ffffff">🎄 Lotería Hash-Chain</text>
    <text x="80" y="140" font-family="system-ui" font-size="20" fill="#bfdbfe">${esGratuita ? 'Participación asignada gratuitamente' : 'Participación aportada'}</text>

    <text x="80" y="230" font-family="system-ui" font-size="22" fill="#94a3b8">NÚMERO</text>
    <text x="80" y="280" font-family="monospace" font-size="64" font-weight="bold" fill="#ffffff">${numero}</text>
    <text x="400" y="280" font-family="monospace" font-size="40" fill="#60a5fa">· ${serie}</text>

    <text x="80" y="340" font-family="system-ui" font-size="22" fill="#94a3b8">SORTEO</text>
    <text x="80" y="380" font-family="system-ui" font-size="28" fill="#e2e8f0">${sorteo}</text>

    ${esGratuita ? `
    <text x="80" y="450" font-family="system-ui" font-size="22" fill="#94a3b8">IMPORTE APORTADO</text>
    <text x="80" y="510" font-family="system-ui" font-size="56" font-weight="bold" fill="#4ade80">${importeMostrado.toFixed(2)} €</text>
    <text x="80" y="560" font-family="system-ui" font-size="22" fill="#94a3b8">VALOR DE REFERENCIA DE LA PARTICIPACIÓN</text>
    <text x="80" y="610" font-family="system-ui" font-size="44" font-weight="bold" fill="#60a5fa">${(importe || 0).toFixed(2)} €</text>
    ` : `
    <text x="80" y="450" font-family="system-ui" font-size="22" fill="#94a3b8">IMPORTE</text>
    <text x="80" y="510" font-family="system-ui" font-size="56" font-weight="bold" fill="#4ade80">${importeMostrado.toFixed(2)} €</text>
    `}

    <text x="80" y="${esGratuita ? 680 : 570}" font-family="system-ui" font-size="22" fill="#94a3b8">PARTICIPANTE</text>
    <text x="80" y="${esGratuita ? 730 : 620}" font-family="system-ui" font-size="36" font-weight="bold" fill="#ffffff">${nombre || 'Anónimo'}</text>

    <text x="80" y="${esGratuita ? 790 : 700}" font-family="system-ui" font-size="16" fill="#64748b">Escanea para verificar la cadena</text>
  </svg>`;

  const overlay = await sharp(Buffer.from(svg)).png().toBuffer();

  // Componer fondo + overlay + QR en esquina
  const comp = await sharp(fondo)
    .composite([
      { input: overlay, top: 0, left: 0 },
      { input: qrBuf, top: esGratuita ? 820 : 720, left: 280 },
    ])
    .png()
    .toBuffer();

  const outFile = path.join(OUT_IMAGES, `${participacionId}.png`);
  fs.writeFileSync(outFile, comp);
  return outFile;
}

module.exports = { generarImagen, OUT_IMAGES };
