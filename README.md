# Registro verificable de participaciones

App web (Node.js + Express + SQLite) para **dejar constancia de quién participa
en un sorteo, boleto o reparto compartido**: cuánto aporta cada persona y qué
porcentaje del reparto le corresponde. Cada partícipe recibe un **comprobante
privado** con QR y PDF.

> La herramienta **no crea sorteos, no vende boletos, no custodia dinero y no
> garantiza resultados**: documenta el acuerdo entre las personas participantes.

## Despliegue

Producción: **`https://loteria-hash.pruebapublica.com`** (subdominio del dominio `pruebapublica.com`).

- El dominio raíz `https://pruebapublica.com` es una landing-vitrina de microservicios
  (repo `mcasrom/pruebapublica-landing`) que enlaza a esta app.
- El `og:image` se genera dinámicamente con el host del request (https vía `trust proxy`).

## Qué incluye

- **Comprobante por participación** (sharp + qrcode): número, serie, sorteo,
  importe, nombre y **QR que abre el comprobante privado** de ese partícipe.
  Guardado en `output-samples/imagenes/<id>.png` (local, no versionado).
- **Documento de constancia** (pdf-lib): datos del acuerdo, % de participación,
  referencia a comunidad de bienes y **sello de integridad** (HMAC-SHA256).
  En `output-samples/pdfs/<id>.pdf`.
- **Endpoint público `/verificar/<id>`**: muestra total, nº de participaciones,
  saldo y estado de la cadena. **Sin nombres ni importes individuales**.
- **Comprobante privado** `/mi-participacion/<access_token>`: única vía al
  comprobante de cada partícipe, con token aleatorio de 256 bits y rate-limit.
- **Panel del organizador**: gestiona solo SU sorteo, ve partícipe/importe/%
  de reparto, comparte enlaces y puede eliminar la última participación.
- **Tema claro/oscuro** en todas las páginas.

## Seguridad

### Cadena de hashes
```
hash_actual = SHA256(hash_anterior | sorteo | importe | timestamp)
```
Cada aportación se encadena con la anterior. Si se altera un importe en la BD,
la verificación lo detecta. **Test que lo demuestra**: alterar un importe rompe
la cadena (10 tests).

### Privacidad
- `participacion_id` interno separado del `access_token` público (256 bits).
- El comprobante solo se sirve por `/mi-participacion/<token>` — no existe otra
  ruta a los archivos.
- `output-samples/` (imágenes y PDFs con nombres reales) **NO se versiona**.
  Backup local en `.privado/` (ignorado).

### Límites honestos
- No es una blockchain: es una cadena de hashes en SQLite. Detecta alteración
  de registros, no inmutabilidad frente a un administrador con acceso total.
- No verifica la existencia/custodia del boleto físico, la identidad real de
  los partícipes ni el resultado oficial del sorteo.
- El PDF es un documento de constancia; su valor probatorio depende de las
  circunstancias y la normativa aplicable.

## Comandos

```bash
cd ~/loteria-hash-chain
npm install
npm run seed         # registro de ejemplo (sorteo compartido, 20€, 3 participaciones)
npm start            # http://localhost:3005 (3000 lo usa otro proyecto)
npm test             # 10 tests
```

## Estructura
```
src/
  app.js                 # Express (fase 2)
  db/schema.js           # SQLite (decimos->registros, participaciones, usuarios)
  db/chain.js            # cadena de hashes + eliminación de última participación
  lib/imagen.js          # imagen de participación (sharp + qrcode)
  lib/pdf.js             # documento de constancia (pdf-lib) + sello de integridad
  lib/og.js              # imagen Open Graph dinámica
  routes/view.js         # landing, panel, participar, comprobante, descargas
  routes/verificar.js    # /verificar/:id público anónimo + og dinámico
assets/
  favicon.svg            # icon view
  og-preview.png         # preview 1200x630
scripts/
  seed.js                # registro de ejemplo
  generar_entregables.js # regenera imágenes/PDFs (local)
tests/chain.test.js      # 10 tests
```

## Despliegue a VPS (Hetzner + Nginx + PM2)

### Variables de entorno
| Variable | Local | Producción |
|---|---|---|
| `PORT` | 3005 | 3005 |
| `DB_PATH` | `./data/loteria.db` | `/data/loteria.db` |
| `SELLO_KEY` | clave local | clave secreta (env) |
| `BASE_URL` | `http://localhost:3005` | `https://loteria-hash.pruebapublica.com` |

```bash
git clone https://github.com/mcasrom/loteria-hash-chain.git
cd loteria-hash-chain && npm install
pm2 start src/app.js --name loteria-hash-chain
# nginx: proxy a 3005 + certbot + DNS a 178.105.80.193
```

## Tests (10/10)
1. Cadena válida pasa la verificación.
2. Alterar un importe rompe la verificación.
3. Emitir por encima del valor_total falla.
4. Importe inválido rechazado.
5. Access_token de 256 bits, único, no derivable del id.
6. Un token → una participación.
7. IDs internos no expuestos vía /verificar.
8. Token inventado → no existe (404).
9. Eliminar la última participación no rompe la cadena.
10. Eliminar intermedia rompe la cadena.
