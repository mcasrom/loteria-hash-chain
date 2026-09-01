# WAYAHEAD · Lotería Hash-Chain

## Estado: HITO COMPLETADO — App en producción (2026-09-01)

### Qué se ha logrado
- App desplegada en `https://loteria-hash.pruebapublica.com` (subdominio de pruebapublica.com).
- Landing vitrina en el dominio raíz `pruebapublica.com` con la tarjeta de lotería
  (repo aparte `mcasrom/pruebapublica-landing`). NO está en viajeinteligencia.com.
- Flujo completo: crear reparto → aportada/gratuita → comprobante QR/PDF → aceptación electrónica → cerrar/sellar.
- Seguridad: panel solo por `organizador_token` (256 bits), retención 12 meses, backups diarios, FK on.
- PDF: modalidades (aportada/gratuita), firma condicional (aceptación registrada vs manuscrita).

### Decisiones clave
- Dominio raíz y app en `pruebapublica.com`; nunca mezclar con `viajeinteligencia.com`.
- Retención: anonimización a los 12 meses del cierre (conserva agregados, borra datos personales).

## Roadmap pendiente
- [ ] Purga de caché tras cambios de OG (documentar en bitácora).
- [ ] Verificar preview de WhatsApp de `loteria-hash` y del dominio raíz con herramienta de validación.
- [ ] Evaluar nivel 2 de firma (firma dibujada) si el usuario lo pide.

## Bitácora de cambios recientes
- 2026-09-01: despliegue real documentado (`610571e`), og https vía trust proxy (`dded602`), fix og dominio raíz (`68b2e87`), fix css (`18c05e6`), firma condicional PDF (`138f8dc`), seguridad+retención (`aa0e923`), modalidad A+D (`7eb5c3e`), fix IIFE panel (`70e986a`).

## Política de retención

- **Lotería**: anonimización a los **12 meses** del cierre del reparto (endpoint `/admin/retencion`, cron dominical con `ADMIN_TOKEN`). Conserva agregados para verificación.
- Documento central del ecosistema con todas las políticas: ver `RETENCION.md` en `mcasrom/nearme-osint`.
