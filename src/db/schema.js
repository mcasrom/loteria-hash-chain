// src/db/schema.js
// Esquema de base de datos SQLite (fase 1).
// Tablas: decimos, participaciones, usuarios.
const path = require('path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS decimos (
  id TEXT PRIMARY KEY,
  organizador_id TEXT NULL,
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
  access_token TEXT NOT NULL UNIQUE
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
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb, DB_PATH: DB_PATH_DEFAULT };
