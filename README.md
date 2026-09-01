# Lotería Hash-Chain — Décimo en participaciones con cadena de hashes

App web (Node.js + Express + SQLite) para repartir un décimo de Lotería de
Navidad (20€) en participaciones, con **verificación pública mediante una
cadena de hashes tipo append-only log** (no blockchain real).

## Seguridad: cómo detecta manipulación

Cada participación guarda `hash_actual = SHA256(hash_anterior | decimo_id |
importe | timestamp)`. Si alguien altera un importe en la BD, el hash
recalculado ya no coincide → la verificación falla. Esto está demostrado por
el test `ALTERAR UN IMPORTE EN BD ROMPE LA VERIFICACIÓN`.

## Comandos

### Local (sin Docker)
```bash
npm install
npm run seed      # crea décimo 85432 (20€) + 3 participaciones (10+5+5)
npm start         # server en http://localhost:3000
npm test          # 4 tests, incluido el de manipulación
```

### Docker
```bash
docker compose up --build   # levanta en localhost:3000
```
> Nota: el build de Docker necesita red (apt-get instala build-essential para
> better-sqlite3). Si falla por DNS, usar la vía local.

## Endpoints (fase 1)
- `POST /decimos` — crear décimo `{numero, serie, sorteo, valor_total}`
- `POST /decimos/:id/participaciones` — añadir `{importe, nombre}` (rechaza si supera valor_total)
- `GET /decimos/:id/verificar` — integridad de la cadena (íntegro: true/false)

## Tests (4/4 pasan)
1. Cadena válida pasa la verificación.
2. **Alterar un importe en BD rompe la verificación** (crítico de seguridad).
3. Emitir por encima del valor_total falla.
4. Importe inválido es rechazado.

## Fase 2 (NO implementada aún)
Generación de imagen, PDF, endpoint público de verificación HTTP, login.
