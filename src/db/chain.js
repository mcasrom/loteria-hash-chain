// src/db/chain.js
const crypto = require("crypto");

const GENESIS = "0".repeat(64);

function hashBlock(prevHash, decimoId, importe, timestamp) {
  const payload = `${prevHash}|${decimoId}|${importe}|${timestamp}`;
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

function computeChain(db, decimoId) {
  const all = db.prepare("SELECT * FROM participaciones WHERE decimo_id = ?").all(decimoId);
  if (all.length === 0) return { participaciones: [], ok: true, n: 0 };
  const byPrev = new Map(all.map((r) => [r.hash_anterior, r]));
  const ordered = [];
  let current = byPrev.get(GENESIS);
  while (current) {
    ordered.push(current);
    current = byPrev.get(current.hash_actual);
  }
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

function validateChain(db, decimoId) {
  return computeChain(db, decimoId).ok;
}

function addParticipacion(db, { decimoId, importe, nombre = null, modalidad = "aportada", importeAportado = null, valorReferencia = null, ip = null }) {
  if (modalidad !== "aportada" && modalidad !== "gratuita") {
    return { ok: false, error: "modalidad_invalida" };
  }

  let valorEconomico;
  let dineroEntregado;
  if (modalidad === "aportada") {
    valorEconomico = typeof importe === "number" && Number.isFinite(importe) ? importe : NaN;
    dineroEntregado = typeof importeAportado === "number" ? importeAportado : valorEconomico;
  } else {
    if (valorReferencia !== null && valorReferencia !== undefined && valorReferencia !== "") {
      valorEconomico = typeof valorReferencia === "number" && Number.isFinite(valorReferencia) ? valorReferencia : parseFloat(valorReferencia);
      if (!Number.isFinite(valorEconomico) || valorEconomico <= 0) {
        return { ok: false, error: "valor_referencia_invalido" };
      }
    } else {
      valorEconomico = 0;
    }
    dineroEntregado = 0;
  }

  if (modalidad === "aportada") {
    if (typeof valorEconomico !== "number" || valorEconomico <= 0 || !Number.isFinite(valorEconomico)) {
      return { ok: false, error: "importe_invalido" };
    }
  }

  const decimo = db.prepare("SELECT * FROM decimos WHERE id = ?").get(decimoId);
  if (!decimo) return { ok: false, error: "decimo_no_existe" };
  if (decimo.estado === "cerrado") {
    return { ok: false, error: "reparto_cerrado", message: "Este reparto esta cerrado. No se pueden anadir mas participaciones." };
  }

  if (ip) {
    const existente = db.prepare("SELECT id FROM participaciones WHERE decimo_id = ? AND registrado_ip = ?").get(decimoId, ip);
    if (existente) {
      return { ok: false, error: "ip_duplicada", message: "Ya existe una participacion registrada desde esta direccion IP." };
    }
  }

  const all = db.prepare("SELECT hash_actual, hash_anterior FROM participaciones WHERE decimo_id = ?").all(decimoId);
  let prevHash = GENESIS;
  if (all.length > 0) {
    const esAnteriorDe = new Set(all.map((r) => r.hash_anterior));
    const ultimo = all.find((r) => !esAnteriorDe.has(r.hash_actual));
    prevHash = ultimo ? ultimo.hash_actual : GENESIS;
  }

  const emitido = db.prepare("SELECT COALESCE(SUM(importe),0) AS total FROM participaciones WHERE decimo_id = ?").get(decimoId).total;

  if (emitido + valorEconomico > decimo.valor_total) {
    return {
      ok: false,
      error: "supera_valor_total",
      message: `No se puede emitir: ${emitido.toFixed(2)} euros ya emitidos + ${valorEconomico.toFixed(2)} euros excede el valor_total de ${decimo.valor_total.toFixed(2)} euros`,
      emitido,
      valor_total: decimo.valor_total,
    };
  }

  const id = crypto.randomUUID();
  const access_token = crypto.randomBytes(32).toString("hex");
  const created_at = new Date().toISOString();
  const hash_actual = hashBlock(prevHash, decimoId, valorEconomico, created_at);

  db.prepare(
    "INSERT INTO participaciones (id, decimo_id, importe, nombre_participante, hash_anterior, hash_actual, created_at, access_token, modalidad, importe_aportado, valor_referencia, registrado_ip) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(id, decimoId, valorEconomico, nombre, prevHash, hash_actual, created_at, access_token, modalidad, dineroEntregado, modalidad === "gratuita" ? valorEconomico : null, ip);

  return {
    ok: true,
    participacion: {
      id,
      decimo_id: decimoId,
      importe: valorEconomico,
      nombre,
      modalidad,
      importe_aportado: dineroEntregado,
      valor_referencia: modalidad === "gratuita" ? valorEconomico : null,
      hash_anterior: prevHash,
      hash_actual,
      created_at,
      access_token,
    },
  };
}

function eliminarUltimaParticipacion(db, decimoId) {
  const all = db.prepare("SELECT * FROM participaciones WHERE decimo_id = ?").all(decimoId);
  if (all.length === 0) return { ok: false, error: "sin_participaciones" };
  const anteriorHashes = new Set(all.map((r) => r.hash_anterior));
  const ultima = all.find((r) => !anteriorHashes.has(r.hash_actual));
  if (!ultima) return { ok: false, error: "cadena_rota_no_eliminable" };
  const emitido = all.reduce((s, r) => s + r.importe, 0);
  db.prepare("DELETE FROM participaciones WHERE id = ?").run(ultima.id);
  return {
    ok: true,
    participacion: { id: ultima.id, importe: ultima.importe, nombre: ultima.nombre_participante },
    emitido_anterior: emitido,
  };
}

module.exports = { hashBlock, GENESIS, computeChain, validateChain, addParticipacion, eliminarUltimaParticipacion };
