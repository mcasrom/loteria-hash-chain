# Lotería Hash-Chain — Décimo en participaciones con cadena de hashes

App web (Node.js + Express + SQLite) para repartir un décimo de Lotería de
Navidad (20€) en participaciones, con **verificación pública mediante una
cadena de hashes tipo append-only log** (no blockchain real).

## Fase 2 — qué incluye

- **Imagen de participación** (sharp + qrcode): número, serie, sorteo, importe,
  nombre y **QR** que apunta a `/verificar/<decimo_id>`. Guardada en
  `output-samples/imagenes/<participacion_id>.png`.
- **PDF legal** (pdf-lib): identificación del décimo, depositario, reparto
  proporcional del premio y **comunidad de bienes (Código Civil)**. En
  `output-samples/pdfs/<participacion_id>.pdf`.
- **Endpoint público `/verificar/<decimo_id>`** (sin login): valor total,
  participaciones emitidas, saldo restante y validación de la cadena (con
  detalle de en qué participación se rompe si está alterada).
- **Open Graph dinámico por participación** — ver nota abajo.
- **UI de participación**: el usuario mete nombre+importe y recibe su imagen y
  PDF. No necesita conocer a los demás partícipes.

## Seguridad: cómo detecta manipulación

Cada participación guarda `hash_actual = SHA256(hash_anterior | decimo_id |
importe | timestamp)`. Si alguien altera un importe en la BD, el hash
recalculado ya no coincide → la verificación falla. Test que lo demuestra:
`ALTERAR UN IMPORTE EN BD ROMPE LA VERIFICACIÓN`.

## IMPORTANTE: Open Graph dinámico o estático

**Es DINÁMICO por participación.** El endpoint
`/verificar/og/participacion/<decimo_id>` genera la imagen PNG **en cada
request** con el número, serie y % emitido del décimo. No es una imagen
estática pre-generada.

> Nota de preview en WhatsApp: WhatsApp cachea el og:image de una URL. La
> primera vez puede tardar o mostrar la versión previa. Para refrescar el
> preview tras cambiar datos, añadir `?v=<timestamp>` al enlace compartido.

## Comandos

### Local (sin Docker) — puerto 3005
```bash
cd ~/loteria-hash-chain
npm install
npm run seed                 # crea décimo 85432 (20€) + 3 participaciones (10+5+5)
npm start                    # server en http://localhost:3005
npm test                     # 4 tests, incluido el de manipulación
```

### Generar entregables (imágenes + PDFs) de las participaciones existentes
```bash
node scripts/generar_entregables.js
# → output-samples/imagenes/*.png y output-samples/pdfs/*.pdf
```

### Docker
```bash
docker compose up --build   # levanta en localhost:3005
```
> Nota: el build de Docker necesita red (apt-get instala build-essential para
> better-sqlite3 y sharp). Si falla por DNS, usar la vía local.

## Rutas para revisar los entregables generados

```bash
ls ~/loteria-hash-chain/output-samples/imagenes/   # 3 PNG (Ana, Luis, Marta)
ls ~/loteria-hash-chain/output-samples/pdfs/        # 3 PDF
```

## Despliegue a VPS (Hetzner + Nginx + PM2 + Docker)

### Variables de entorno (local vs producción)
| Variable | Local | Producción |
|---|---|---|
| `PORT` | 3005 | 3005 (o 3100 si 3005 ocupado) |
| `DB_PATH` | `./data/loteria.db` | `/data/loteria.db` (volumen) |
| `BASE_URL` | `http://localhost:3005` | `https://loteria.viajeinteligencia.com` |

> Nota: `BASE_URL` se usa para generar el QR correcto. En producción apunta
> al dominio público, no a localhost.

### Pasos

```bash
# 1. Clonar en el server
git clone https://github.com/mcasrom/loteria-hash-chain.git /home/deploy/loteria-hash-chain
cd /home/deploy/loteria-hash-chain

# 2. Instalar y build
npm install

# 3. Arrancar con PM2
pm2 start src/app.js --name loteria-hash-chain --env PORT=3005
pm2 save

# 4. Nginx (vhost estático + proxy)
# /etc/nginx/sites-available/loteria.viajeinteligencia.com
#   server_name loteria.viajeinteligencia.com;
#   location / { proxy_pass http://127.0.0.1:3005; proxy_set_header Host $host; }
#   # + SSL con certbot

# 5. Certbot
sudo certbot --nginx -d loteria.viajeinteligencia.com

# 6. DNS: loteria -> 178.105.80.193 (Cloudflare, naranja tras emitir cert)
```

### Docker en VPS (alternativa)
```bash
docker compose up -d --build   # puerto 3005, volumen ./data
```

## Tests (4/4 pasan)
1. Cadena válida pasa la verificación.
2. **Alterar un importe en BD rompe la verificación** (crítico de seguridad).
3. Emitir por encima del valor_total falla.
4. Importe inválido es rechazado.

## Estructura
```
src/
  app.js                 # Express (fase 2)
  db/schema.js           # SQLite (decimos, participaciones, usuarios)
  db/chain.js            # cadena de hashes
  lib/imagen.js          # imagen de participación (sharp + qrcode)
  lib/pdf.js             # PDF legal (pdf-lib)
  lib/og.js              # imagen Open Graph dinámica
  routes/view.js         # página principal + API + descargas
  routes/verificar.js    # /verificar/:id público + og dinámico
scripts/
  seed.js                # décimo ejemplo 85432
  generar_entregables.js # regenera imágenes/PDFs
tests/chain.test.js      # 4 tests
output-samples/          # imágenes y PDFs generados (versionados)
```
