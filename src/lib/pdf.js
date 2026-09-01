// src/lib/pdf.js
// Genera el PDF del documento legal de la participación: identificación del
// décimo, depositario, reparto proporcional del premio y referencia a
// comunidad de bienes (Código Civil). Usa pdf-lib.
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const path = require('path');
const fs = require('fs');

const OUT_PDFS = path.join(__dirname, '..', '..', 'output-samples', 'pdfs');

async function generarPdf({ participacionId, numero, serie, sorteo, importe, nombre, valorTotal, decimoId, depositario = 'Organizador' }) {
  fs.mkdirSync(OUT_PDFS, { recursive: true });

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const y = (pt) => 842 - pt;

  page.drawText('DOCUMENTO DE PARTICIPACIÓN EN DÉCIMO DE LOTERÍA', {
    x: 50, y: y(60), size: 14, font: bold, color: rgb(0.1, 0.1, 0.2),
  });
  page.drawText('Sorteo de Navidad — Lotería Hash-Chain', {
    x: 50, y: y(85), size: 10, font, color: rgb(0.3, 0.3, 0.4),
  });

  page.drawText('1. Identificación del décimo', { x: 50, y: y(130), size: 11, font: bold });
  page.drawText(`   Número: ${numero}   Serie: ${serie}`, { x: 50, y: y(152), size: 11, font });
  page.drawText(`   Sorteo: ${sorteo}`, { x: 50, y: y(170), size: 11, font });
  page.drawText(`   Valor total del décimo: ${valorTotal.toFixed(2)} €`, { x: 50, y: y(188), size: 11, font });

  page.drawText('2. Depositario', { x: 50, y: y(230), size: 11, font: bold });
  page.drawText(`   El décimo queda depositado bajo custodia de: ${depositario}`, { x: 50, y: y(252), size: 11, font });

  page.drawText('3. Participación', { x: 50, y: y(290), size: 11, font: bold });
  page.drawText(`   Participante: ${nombre || 'Anónimo'}`, { x: 50, y: y(312), size: 11, font });
  page.drawText(`   Importe aportado: ${importe.toFixed(2)} €`, { x: 50, y: y(330), size: 11, font });
  const pct = (importe / valorTotal) * 100;
  page.drawText(`   Cuota proporcional del premio: ${pct.toFixed(2)} %`, { x: 50, y: y(348), size: 11, font });

  page.drawText('4. Comunidad de bienes', { x: 50, y: y(390), size: 11, font: bold });
  const lines = [
    'Las participaciones de este décimo constituyen una comunidad de bienes',
    '(artículos 392 a 406 del Código Civil español). Cada partícipe es titular',
    'proporcional del premio que corresponda, en función de su aportación.',
    'El depositario se obliga a repartir el premio entre los partícipes según',
    'las cuotas declaradas en este documento. En caso de premio, la parte',
    'correspondiente a cada partícipe se abonará en proporción a su importe.',
  ];
  lines.forEach((line, i) => {
    page.drawText(line, { x: 50, y: y(412 + i * 16), size: 10, font });
  });

  page.drawText('5. Verificación', { x: 50, y: y(520), size: 11, font: bold });
  page.drawText(`   ID de participación: ${participacionId}`, { x: 50, y: y(542), size: 10, font });
  page.drawText(`   Décimo: ${decimoId}`, { x: 50, y: y(558), size: 10, font });
  page.drawText('   Verificación pública: /verificar/' + decimoId, { x: 50, y: y(574), size: 10, font });
  page.drawText('   (La integridad de la cadena de hashes garantiza que los importes', { x: 50, y: y(590), size: 9, font });
  page.drawText('    no han sido alterados después de su emisión.)', { x: 50, y: y(604), size: 9, font });

  page.drawText('Firma del partícipe: ______________________   Fecha: ______', { x: 50, y: y(650), size: 11, font });
  page.drawText('Firma del depositario: ______________________   Fecha: ______', { x: 50, y: y(680), size: 11, font });

  const buf = await pdf.save();
  const outFile = path.join(OUT_PDFS, `${participacionId}.pdf`);
  fs.writeFileSync(outFile, buf);
  return outFile;
}

module.exports = { generarPdf, OUT_PDFS };
