#!/usr/bin/env bash
# scripts/backup.sh
# Backup diario de la BD de lotería-hash (retener 30 copias) + salida limpia.
# Uso: scripts/backup.sh [dir_destino]
set -euo pipefail

APP_DIR="${APP_DIR:-/home/deploy/loteria-hash-chain}"
BACKUP_DIR="${1:-${APP_DIR}/backups}"
DB="${APP_DIR}/data/loteria.db"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="${BACKUP_DIR}/loteria-${STAMP}.db"

# copia consistente con SQLite: usa backup API via sqlite3
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "${DB}" ".backup '${DEST}'"
else
  # fallback: copia del archivo (WAL garantiza consistencia del -wal)
  cp "${DB}" "${DEST}"
fi

# rotar: conservar solo las últimas 30
ls -1t "${BACKUP_DIR}"/loteria-*.db 2>/dev/null | tail -n +31 | xargs -r rm -f

echo "backup ok: ${DEST} (retención 30 copias)"
