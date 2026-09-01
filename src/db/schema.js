// src/db/schema.js
// Esquema de base de datos SQLite (fase 1).
// Tablas: decimos, participaciones, usuarios.
const path = require('path');
const crypto = require('crypto');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS decimos (
  id TEXT PRIMARY KEY,
  organizador_id TEXT NULL,
  organizador_token TEXT NULL,
  numero TEXT NOT NULL,
  serie TEXT NOT NULL,
  sorteo TEXT NOT NULL,
  valor_total REAL NOT NULL,
  created_at TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'abierto'
);

CREATE TABLE IF NOT EXISTS participaciones (
  id TEXT PRIMARY KEY,
  decimo_id TEXT NOT NULL REFERENCES decimos(id),
  importe REAL NOT NULL,
  nombre_participante TEXT NULL,
  hash_anterior TEXT NOT NULL,
  hash_actual TEXT NOT NULL,
  created_at TEXT NOT NULL,
  access_token TEXT NOT NULL UNIQUE,
  modalidad TEXT NOT NULL DEFAULT 'aportada',
  importe_aportado REAL NULL,
  valor_referencia REAL NULL,
  aceptado_at TEXT NULL,
  aceptado_ip TEXT NULL,
  aceptado_ua TEXT NULL,
  aceptado_hash TEXT NULL
);

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

const DB_PATH_DEFAULT = path.join(__dirname, '..', '..', 'data', 'loteria.db');

function openDb() {
  const Database = require('better-sqlite3');
  // Leer DB_PATH en cada llamada (no al cargar) para que los tests puedan
  // usar una BD temporal por test.
  const dbPath = process.env.DB_PATH || DB_PATH_DEFAULT;
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrar(db);
  return db;
}

// Migración suave: añade columnas nuevas a BDs creadas con un esquema antiguo.
function migrar(db) {
  const colsDecimos = db.prepare(`PRAGMA table_info(decimos)`).all().map((c) => c.name);
  if (!colsDecimos.includes('organizador_token')) {
    db.exec(`ALTER TABLE decimos ADD COLUMN organizador_token TEXT NULL`);
    // Backfill: generar token para los decimos existentes que no lo tienen
    const rows = db.prepare(`SELECT id FROM decimos WHERE organizador_token IS NULL`).all();
    for (const r of rows) {
      db.prepare(`UPDATE decimos SET organizador_token = ? WHERE id = ?`).run(crypto.randomBytes(32).toString('hex'), r.id);
    }
  }

  const cols = db.prepare(`PRAGMA table_info(participaciones)`).all().map((c) => c.name);
  const nuevas = {
    modalidad: "TEXT NOT NULL DEFAULT 'aportada'",
    importe_aportado: 'REAL NULL',
    valor_referencia: 'REAL NULL',
    aceptado_at: 'TEXT NULL',
    aceptado_ip: 'TEXT NULL',
    aceptado_ua: 'TEXT NULL',
    aceptado_hash: 'TEXT NULL',
  };
  for (const [name, def] of Object.entries(nuevas)) {
    if (!cols.includes(name)) db.exec(`ALTER TABLE participaciones ADD COLUMN ${name} ${def}`);
  }
}

module.exports = { openDb, DB_PATH: DB_PATH_DEFAULT };
