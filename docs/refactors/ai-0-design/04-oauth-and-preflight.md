# OAuth y evidencia operativa previa

Estado: análisis estático `VERIFICADO`; causa del incidente en ejecución
`NO_VERIFICABLE` con la evidencia disponible. Seguimiento: [#193](https://github.com/jarvinc3/personal-os-back/issues/193).

El flujo actual solicita acceso offline, consentimiento y gmail.readonly; usa
state JWT con expiración de quince minutos. El callback rechaza una respuesta
sin refresh token antes de comprobar si la conexión ya tiene uno. El refresh se
adelanta cinco minutos, conserva el refresh token cifrado anterior y no ofrece
exclusión mutua/CAS entre fuentes que comparten conexión. Son rutas comprobables
en código, no prueba de que hayan causado el fallo observado.

Google documenta que el refresh token no acompaña necesariamente cada intercambio
y que proyectos External en Testing con scopes como Gmail pueden tener tokens
de siete días. También hay revocación, límites e invalidación por otras causas.
Fuentes: [flujo offline](https://developers.google.com/identity/protocols/oauth2/web-server#offline),
[expiración y revocación](https://developers.google.com/identity/protocols/oauth2#expiration).

Antes de atribuir una causa se necesita registrar, sin tokens ni contenido de
correo: timestamp, entorno, revisión desplegada, correlationId, conexión
seudonimizada, operación callback/refresh, HTTP status, código Google como
invalid_grant y presencia booleana de refresh token nuevo/existente. Contrastar
estado Testing/Production del consentimiento, proyecto/cliente OAuth y redirect
URI efectivos; comprobar rotación de clave de cifrado y concurrencia. No copiar
secretos a issues, logs o este paquete.

La decisión de AI-0 es retirar esta integración, no reconstruirla para conservar
un callback muerto. Si el corte estable necesita un hotfix OAuth previo, debe
tener reproducción y prueba propia antes de entrar a la rama estable.

## Corte y Supabase

El corte estable confirmado por el owner es 0.55.3. El reporte PROD recibido
se capturó el 2026-10-24, servidor PostgreSQL 17.6, con 67 migraciones
completadas. Su SHA-256 es `6a0198fc065bb3454eb0bb686f7c30afd27768098cf5400e8c6cfd12c860b1f2`.
El reporte no guarda el project ref Supabase; por ello no identifica por sí solo
si la configuración local apunta a DEV o PROD.

El [preflight SQL](artifacts/prod-preflight.readonly.sql) usa transacción de solo
lectura y timeouts. Debe ejecutarse identificando proyecto/entorno y guardando
metadatos de resultados saneados: migraciones/checksums, namespaces de
extensiones, RLS/policies, grants, funciones SECURITY DEFINER y trigger Auth.
El reporte ya se auditó contra el manifiesto. No se ha escrito en PROD ni se ha
accedido a logs operativos de Google.

Comprobar expresamente uuid-ossp y su esquema antes de usar los defaults
cualificados de la candidata; no mover extensiones gestionadas. Inspeccionar
event triggers de RLS, versión PostgreSQL y objetos manuales ausentes del repo.
Supabase recomienda habilitar RLS en tablas expuestas; aquí además se conservan
los REVOKE de #169: RLS no sustituye los privilegios de acceso.
Fuentes: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[cambios PostgreSQL 15.19/17.11](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).

Infisical sigue siendo la fuente de configuración dev/prod para back/web.
El diseño no cambia secretos, Railway, Vercel ni sincronizaciones de entorno.
