// src/db/chain.js
// Lógica de la cadena de hashes (append-only log, no blockchain real).
//
// hash_actual = SHA256(hash_anterior + decimo_id + importe + timestamp)
//
// - validateChain(decimoId): recorre todas las participaciones y confirma
//   que cada hash_actual coincide con el recalculado. Si se alteró un
//   importe (o cualquier campo) en BD, el hash deja de coincidir.
// - addParticipacion: rechaza si la suma emitida + nuevo importe > valor_total.
const crypto = require('crypto');

// Hash "genesis" cuando no hay participaciones anteriores.
const GENESIS = '0'.repeat(64);

function hashBlock(prevHash, decimoId, importe, timestamp) {
  const payload = `${prevHash}|${decimoId}|${importe}|${timestamp}`;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Calcula la cadena completa esperada de un décimo.
 * Devuelve { participaciones, ok } donde ok = true si TODA la cadena
 * es íntegra (cada hash_actual coincide con el recalculado y encadena).
 *
 * IMPORTANTE: recorre siguiendo la cadena real (por hash_anterior), no por
 * created_at, porque con timestamps idénticos al milisegundo el orden de
 * inserción no es reproducible. El hash_anterior ES el puntero de encadenado.
 */
function computeChain(db, decimoId) {
  const all = db
    .prepare('SELECT * FROM participaciones WHERE decimo_id = ?')
    .all(decimoId);

  if (all.length === 0) return { participaciones: [], ok: true, n: 0 };

  // indexar por hash_ANTERIOR para seguir la cadena hacia adelante:
  // el primer bloque tiene hash_anterior = GENESIS, el siguiente tiene
  // hash_anterior = hash_actual del primero, etc.
  const byPrev = new Map(all.map((r) => [r.hash_anterior, r]));

  const ordered = [];
  let current = byPrev.get(GENESIS);
  while (current) {
    ordered.push(current);
    current = byPrev.get(current.hash_actual);
  }

  // si no se recorrieron todos, hay un enlace roto o duplicado en la cadena
  if (ordered.length !== all.length) {
    return { participaciones: ordered.map((r) => ({ id: r.id, importe: r.importe, ok: false })), ok: false, n: all.length };
  }

  let prev = GENESIS;
  let ok = true;
  const checked = [];
  for (const r of ordered) {
    const expected = hashBlock(prev, r.decimo_id, r.importe, r.created_at);
    const good = r.hash_actual === expected && r.hash_anterior === prev;
    if (!good) ok = false;
    checked.push({ id: r.id, importe: r.importe, hash_actual: r.hash_actual, expected, ok: good });
    prev = r.hash_actual;
  }
  return { participaciones: checked, ok, n: all.length };
}

/**
 * Valida la integridad completa de la cadena de un décimo.
 * Devuelve true si toda la cadena es válida.
 */
function validateChain(db, decimoId) {
  return computeChain(db, decimoId).ok;
}

/**
 * Crea una participación. Rechaza si:
 *  - el décimo no existe;
 *  - la suma de importes ya emitidos + el nuevo importe supera valor_total;
 *  - modalidad 'aportada' (default): importe > 0 es el dinero entregado.
 *  - modalidad 'gratuita': importe_aportado es 0, valor_referencia (>0) es el
 *    valor económico de la cuota regalada (para calcular el % y el control del 100%).
 * Devuelve { ok, error?, participacion? }
 */
function addParticipacion(db, { decimoId, importe, nombre = null, modalidad = 'aportada', importeAportado = null, valorReferencia = null }) {
  if (modalidad !== 'aportada' && modalidad !== 'gratuita') {
    return { ok: false, error: 'modalidad_invalida' };
  }

  // En 'aportada', el importe ES el dinero entregado y el valor económico.
  // En 'gratuita', el importe_aportado es 0 y el valor económico (que ocupa
  // capacidad del valor_total) es valorReferencia.
  let valorEconomico;
  let dineroEntregado;
  if (modalidad === 'aportada') {
    valorEconomico = typeof importe === 'number' && Number.isFinite(importe) ? importe : NaN;
    dineroEntregado = typeof importeAportado === 'number' ? importeAportado : valorEconomico;
  } else {
    valorEconomico = typeof valorReferencia === 'number' && Number.isFinite(valorReferencia) ? valorReferencia : NaN;
    dineroEntregado = 0;
  }
  if (typeof valorEconomico !== 'number' || valorEconomico <= 0 || !Number.isFinite(valorEconomico)) {
    return { ok: false, error: modalidad === 'aportada' ? 'importe_invalido' : 'valor_referencia_invalido' };
  }

  const decimo = db.prepare('SELECT * FROM decimos WHERE id = ?').get(decimoId);
  if (!decimo) return { ok: false, error: 'decimo_no_existe' };
  if (decimo.estado === 'cerrado') {
    return { ok: false, error: 'reparto_cerrado', message: 'Este reparto está cerrado. No se pueden añadir más participaciones.' };
  }

  // hash del último bloque de la cadena: el que NO es hash_anterior de ningún otro.
  // (No usar ORDER BY created_at: con timestamps al mismo ms el orden es no-determinista.)
  const all = db.prepare('SELECT hash_actual, hash_anterior FROM participaciones WHERE decimo_id = ?').all(decimoId);
  let prevHash = GENESIS;
  if (all.length > 0) {
    const esAnteriorDe = new Set(all.map((r) => r.hash_anterior));
    const ultimo = all.find((r) => !esAnteriorDe.has(r.hash_actual));
    prevHash = ultimo ? ultimo.hash_actual : GENESIS;
  }

  // El control del 100% usa el valor ECONÓMICO de cada participación
  // (aportada => importe; gratuita => valor_referencia), porque un regalo
  // también ocupa cuota del décimo.
  const emitido = db
    .prepare('SELECT COALESCE(SUM(importe),0) AS total FROM participaciones WHERE decimo_id = ?')
    .get(decimoId).total;

  if (emitido + valorEconomico > decimo.valor_total) {
    return {
      ok: false,
      error: 'supera_valor_total',
      message: `No se puede emitir: ${emitido.toFixed(2)}€ ya emitidos + ${valorEconomico.toFixed(2)}€ excede el valor_total de ${decimo.valor_total.toFixed(2)}€`,
      emitido,
      valor_total: decimo.valor_total,
    };
  }

  const id = crypto.randomUUID();
  const access_token = crypto.randomBytes(32).toString('hex'); // 256 bits, secreto del partícipe
  const created_at = new Date().toISOString();
  const hash_actual = hashBlock(prevHash, decimoId, valorEconomico, created_at);

  db.prepare(
    'INSERT INTO participaciones (id, decimo_id, importe, nombre_participante, hash_anterior, hash_actual, created_at, access_token, modalidad, importe_aportado, valor_referencia) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).run(id, decimoId, valorEconomico, nombre, prevHash, hash_actual, created_at, access_token, modalidad, dineroEntregado, modalidad === 'gratuita' ? valorEconomico : null);

  return {
    ok: true,
    participacion: {
      id,
      decimo_id: decimoId,
      importe: valorEconomico,
      nombre,
      modalidad,
      importe_aportado: dineroEntregado,
      valor_referencia: modalidad === 'gratuita' ? valorEconomico : null,
      hash_anterior: prevHash,
      hash_actual,
      created_at,
      access_token,
    },
  };
}

/**
 * Elimina la ÚLTIMA participación de un décimo (para corregir errores:
 * doble clic, asignación equivocada).
 *
 * SOLO se puede eliminar la última de la cadena: eliminar una intermedia
 * rompería la cadena (las siguientes apuntan a su hash). Al quitar la última,
 * las anteriores siguen encadenando correctamente.
 *
 * Devuelve { ok, error?, participacion? } con la participación eliminada.
 */
function eliminarUltimaParticipacion(db, decimoId) {
  // Obtener la última participación SIGUIENDO la cadena (no por fecha):
  // el último bloque es el que NO es hash_anterior de ningún otro.
  const all = db.prepare('SELECT * FROM participaciones WHERE decimo_id = ?').all(decimoId);
  if (all.length === 0) return { ok: false, error: 'sin_participaciones' };

  const anteriorHashes = new Set(all.map((r) => r.hash_anterior));
  const ultima = all.find((r) => !anteriorHashes.has(r.hash_actual));
  if (!ultima) return { ok: false, error: 'cadena_rota_no_eliminable' };

  const emitido = all.reduce((s, r) => s + r.importe, 0);
  db.prepare('DELETE FROM participaciones WHERE id = ?').run(ultima.id);
  return {
    ok: true,
    participacion: { id: ultima.id, importe: ultima.importe, nombre: ultima.nombre_participante },
    emitido_anterior: emitido,
  };
}

module.exports = { hashBlock, GENESIS, computeChain, validateChain, addParticipacion, eliminarUltimaParticipacion };
