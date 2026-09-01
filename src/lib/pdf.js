// src/lib/pdf.js
// Genera el PDF del documento de participación según la modalidad:
//  - 'aportada': el partícipe entregó dinero y recibe una cuota económica.
//  - 'gratuita': el organizador asigna gratuitamente una cuota (regalo).
// Redacción prudente: no afirma automáticamente comunidad de bienes ni que la
// plataforma verifica el décimo físico. Usa pdf-lib.
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const OUT_PDFS = path.join(__dirname, '..', '..', 'output-samples', 'pdfs');
// Clave del servidor para el sello de integridad (env). No es firma electrónica
// legal: es una prueba de que el contenido no se modificó tras generarse.
const SELLO_KEY = process.env.SELLO_KEY || 'aegis-loteria-sello-clave-local';

function selloIntegridad(participacionId, numero, serie, importe, nombre, modalidad) {
  const payload = `${participacionId}|${numero}|${serie}|${importe}|${nombre}|${modalidad}`;
  return crypto.createHmac('sha256', SELLO_KEY).update(payload, 'utf8').digest('hex');
}

async function generarPdf({ participacionId, numero, serie, sorteo, importe, nombre, valorTotal, decimoId, depositario = 'Organizador', modalidad = 'aportada', aceptacion = null }) {
  fs.mkdirSync(OUT_PDFS, { recursive: true });

  const esGratuita = modalidad === 'gratuita';
  const valorEco = esGratuita ? (importe || 0) : (importe || 0);
  const dineroEntregado = esGratuita ? 0 : (importe || 0);
  const sello = selloIntegridad(participacionId, numero, serie, valorEco, nombre, modalidad);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const y = (pt) => 842 - pt;

  page.drawText(esGratuita
    ? 'DOCUMENTO DE ASIGNACIÓN GRATUITA DE PARTICIPACIÓN EN DÉCIMO'
    : 'ACUERDO PRIVADO DE PARTICIPACIÓN Y REPARTO EN DÉCIMO DE LOTERÍA', {
    x: 50, y: y(55), size: 13, font: bold, color: rgb(0.1, 0.1, 0.2),
  });
  page.drawText(`Sorteo de Navidad — Lotería Hash-Chain · Modalidad: ${esGratuita ? 'asignación gratuita' : 'participación aportada'}`, {
    x: 50, y: y(78), size: 9, font, color: rgb(0.35, 0.35, 0.45),
  });

  page.drawText('1. Identificación del décimo', { x: 50, y: y(120), size: 11, font: bold });
  page.drawText(`   Número: ${numero}   Serie: ${serie}`, { x: 50, y: y(142), size: 11, font });
  page.drawText(`   Sorteo: ${sorteo}`, { x: 50, y: y(160), size: 11, font });
  page.drawText(`   Valor total del décimo: ${valorTotal.toFixed(2)} €`, { x: 50, y: y(178), size: 11, font });

  page.drawText('2. Custodia declarada del décimo', { x: 50, y: y(218), size: 11, font: bold });
  page.drawText(`   Persona que declara conservar el décimo original: ${depositario}`, { x: 50, y: y(240), size: 11, font });
  page.drawText('   La plataforma no ha inspeccionado físicamente el décimo ni', { x: 50, y: y(258), size: 9, font, color: rgb(0.4, 0.4, 0.5) });
  page.drawText('   verifica su existencia, autenticidad o custodia.', { x: 50, y: y(272), size: 9, font, color: rgb(0.4, 0.4, 0.5) });

  page.drawText('3. Participación', { x: 50, y: y(310), size: 11, font: bold });
  page.drawText(`   Partícipe: ${nombre || 'Anónimo'}`, { x: 50, y: y(332), size: 11, font });
  page.drawText(`   Modalidad: ${esGratuita ? 'asignación gratuita (regalo)' : 'participación aportada'}`, { x: 50, y: y(350), size: 11, font });
  if (esGratuita) {
    page.drawText(`   Importe aportado por el partícipe: 0,00 €`, { x: 50, y: y(368), size: 11, font });
    page.drawText(`   Valor de referencia de la participación: ${valorEco.toFixed(2)} €`, { x: 50, y: y(386), size: 11, font });
  } else {
    page.drawText(`   Importe aportado: ${dineroEntregado.toFixed(2)} €`, { x: 50, y: y(368), size: 11, font });
  }
  const pct = valorTotal > 0 ? (valorEco / valorTotal) * 100 : 0;
  page.drawText(`   Cuota de participación sobre el décimo: ${pct.toFixed(2)} %`, { x: 50, y: y(404), size: 11, font });

  page.drawText('4. Acuerdo entre las partes', { x: 50, y: y(446), size: 11, font: bold });
  const lines = esGratuita ? [
    'El organizador declara haber asignado gratuitamente al partícipe la cuota',
    'indicada sobre los derechos económicos que pudieran corresponder al décimo,',
    'sin que el partícipe haya entregado contraprestación por dicha asignación.',
    '',
    'Esta modalidad puede tener implicaciones civiles o fiscales de donación según',
    'las circunstancias concretas. Esta plataforma no calcula ni declara impuestos.',
  ] : [
    'Las partes declaran que la participación documentada representa una cuota',
    'económica sobre el décimo identificado, conforme al acuerdo alcanzado entre',
    'ellas. Cuando resulte aplicable por la naturaleza real del acuerdo, dicha',
    'relación podrá configurarse como una comunidad de bienes conforme a los',
    'artículos 392 y siguientes del Código Civil español.',
    'Este documento no constituye asesoramiento jurídico ni determina por sí solo',
    'la calificación civil o fiscal de la operación.',
  ];
  lines.forEach((line, i) => {
    page.drawText(line, { x: 50, y: y(468 + i * 14), size: 10, font });
  });

  page.drawText('5. Reparto', { x: 50, y: y(588), size: 11, font: bold });
  page.drawText('   Si el décimo resultara premiado, el importe neto que corresponda', { x: 50, y: y(610), size: 10, font });
  page.drawText('   se distribuirá conforme a la cuota registrada, una vez aplicadas, en su', { x: 50, y: y(626), size: 10, font });
  page.drawText('   caso, las retenciones y obligaciones fiscales pertinentes. La entidad', { x: 50, y: y(642), size: 10, font });
  page.drawText('   pagadora podrá exigir la identificación de los beneficiarios y documentación.', { x: 50, y: y(658), size: 10, font });

  page.drawText('6. Verificación', { x: 50, y: y(690), size: 11, font: bold });
  page.drawText(`   ID de participación: ${participacionId}`, { x: 50, y: y(712), size: 9, font, color: rgb(0.35, 0.35, 0.45) });
  page.drawText(`   Décimo: ${decimoId}`, { x: 50, y: y(726), size: 9, font, color: rgb(0.35, 0.35, 0.45) });
  page.drawText(`   Verificación pública: /verificar/${decimoId}`, { x: 50, y: y(740), size: 9, font, color: rgb(0.35, 0.35, 0.45) });
  page.drawText('   La verificación criptográfica permite detectar cambios respecto de la', { x: 50, y: y(754), size: 8, font, color: rgb(0.45, 0.45, 0.55) });
  page.drawText('   versión registrada y sellada por el sistema. No acredita por sí sola la', { x: 50, y: y(766), size: 8, font, color: rgb(0.45, 0.45, 0.55) });
  page.drawText('   existencia, autenticidad, titularidad o custodia física del décimo.', { x: 50, y: y(778), size: 8, font, color: rgb(0.45, 0.45, 0.55) });

  page.drawText('7. Sello de integridad', { x: 50, y: y(800), size: 11, font: bold });
  page.drawText(`   HMAC-SHA256 del contenido: ${sello}`, { x: 50, y: y(818), size: 7.5, font, color: rgb(0.4, 0.4, 0.5) });

  // === PÁGINA 2: aceptación + declaraciones ===
  const page2 = pdf.addPage([595, 842]);
  const y2 = (pt) => 842 - pt;

  page2.drawText('8. Aceptación', { x: 50, y: y2(55), size: 11, font: bold });
  if (aceptacion && aceptacion.at) {
    page2.drawText('   Aceptación electrónica registrada', { x: 50, y: y2(77), size: 10, font: bold });
    page2.drawText(`   Método: enlace privado + confirmación`, { x: 50, y: y2(97), size: 9, font });
    page2.drawText(`   Fecha y hora UTC: ${aceptacion.at}`, { x: 50, y: y2(113), size: 9, font });
    page2.drawText(`   Hash del documento aceptado: ${aceptacion.hash}`, { x: 50, y: y2(129), size: 8, font, color: rgb(0.4, 0.4, 0.5) });
    page2.drawText('   No es una firma electrónica cualificada: es constancia de lectura y', { x: 50, y: y2(145), size: 8, font, color: rgb(0.4, 0.4, 0.5) });
    page2.drawText('   aceptación mediante el enlace privado de esta participación.', { x: 50, y: y2(159), size: 8, font, color: rgb(0.4, 0.4, 0.5) });
  } else {
    page2.drawText('   Pendiente: el partícipe aún no ha confirmado la lectura y aceptación.', { x: 50, y: y2(77), size: 9, font });
  }

  page2.drawText('9. Declaraciones', { x: 50, y: y2(205), size: 11, font: bold });
  page2.drawText('DECLARACIÓN DEL PARTÍCIPE', { x: 50, y: y2(227), size: 9, font: bold });
  page2.drawText('He leído los datos y condiciones de esta versión y acepto la participación', { x: 50, y: y2(245), size: 9, font });
  page2.drawText('indicada, en la modalidad descrita.', { x: 50, y: y2(259), size: 9, font });
  if (aceptacion && aceptacion.at) {
    page2.drawText('   Firma del partícipe: [X] Aceptación electrónica registrada', { x: 50, y: y2(277), size: 9, font: bold });
    page2.drawText('   Método: enlace privado + confirmación', { x: 50, y: y2(291), size: 8.5, font, color: rgb(0.35, 0.35, 0.45) });
    page2.drawText(`   Fecha UTC: ${aceptacion.at}`, { x: 50, y: y2(305), size: 8.5, font, color: rgb(0.35, 0.35, 0.45) });
    page2.drawText(`   Hash del documento aceptado: ${aceptacion.hash}`, { x: 50, y: y2(319), size: 8, font, color: rgb(0.45, 0.45, 0.55) });
  } else {
    page2.drawText('   Firma del partícipe: ____________________   Fecha: ______', { x: 50, y: y2(277), size: 9, font });
  }
  page2.drawText('DECLARACIÓN DEL ORGANIZADOR', { x: 50, y: y2(343), size: 9, font: bold });
  page2.drawText('Declaro que los datos del décimo, la modalidad y la cuota han sido registrados', { x: 50, y: y2(361), size: 9, font });
  page2.drawText('según mi declaración.   Firma: ____________   Fecha: ______', { x: 50, y: y2(375), size: 9, font });

  page2.drawText('10. Advertencias', { x: 50, y: y2(419), size: 11, font: bold });
  page2.drawText('— Este documento deja constancia de una participación o asignación declarada', { x: 50, y: y2(441), size: 8, font, color: rgb(0.45, 0.45, 0.55) });
  page2.drawText('entre las partes. No acredita por sí solo la existencia, autenticidad, titularidad', { x: 50, y: y2(455), size: 8, font, color: rgb(0.45, 0.45, 0.55) });
  page2.drawText('o custodia física del décimo, ni sustituye las obligaciones de identificación,', { x: 50, y: y2(469), size: 8, font, color: rgb(0.45, 0.45, 0.55) });
  page2.drawText('tributación o pago que puedan resultar aplicables.', { x: 50, y: y2(483), size: 8, font, color: rgb(0.45, 0.45, 0.55) });
  page2.drawText('— Este documento no sustituye la identificación exigida por la entidad pagadora', { x: 50, y: y2(499), size: 8, font, color: rgb(0.45, 0.45, 0.55) });
  page2.drawText('ni garantiza el tratamiento fiscal de la operación. En caso de premio, pueden', { x: 50, y: y2(513), size: 8, font, color: rgb(0.45, 0.45, 0.55) });
  page2.drawText('ser necesarios documentos identificativos adicionales.', { x: 50, y: y2(527), size: 8, font, color: rgb(0.45, 0.45, 0.55) });

  const buf = await pdf.save();
  const outFile = path.join(OUT_PDFS, `${participacionId}.pdf`);
  fs.writeFileSync(outFile, buf);
  return outFile;
}

module.exports = { generarPdf, OUT_PDFS };
