# Banco Popular Dominicano: correos de ejemplo

Fixtures reales anonimizados, sacados de Gmail el 13/10/2026. Cuentas y tarjetas están enmascaradas con los últimos 4 dígitos. Montos, terceros, números de confirmación, referencias, emails y teléfonos personales son ficticios. Se conservan el remitente, el asunto, la estructura HTML, los ids y los formatos de fecha. En `expected` de cada `.json` están los campos extraídos esperados.

| Tipo | Remitente | Asunto | Para qué sirve |
|---|---|---|---|
| `deposito-nomina-v1-corto` | notificaciones@popularenlinea.com | Notificación Depósito de Nómina | Variante más corta de la plantilla v1 (jun-2026); el cuerpo es igual a v1. |
| `deposito-nomina-v1` | notificaciones@popularenlinea.com | Notificación Depósito de Nómina | Depósito de nómina, plantilla anterior (hasta jul-2026). Fecha yyyyMMdd y sin monto. |
| `deposito-nomina-v2` | notificaciones@popularenlinea.com | Notificación Depósito de Nómina | Depósito de nómina, plantilla nueva (ago-2026 en adelante). Sin monto ni fecha en el cuerpo. |
| `pagos-al-instante-en-proceso` | NOTIFICACIONES@popularenlinea.com | Notificaciones Pagos al Instante transferencia en proceso | Transferencia instantánea en proceso. Mismo cuerpo que la enviada: deduplicar. |
| `pagos-al-instante-enviada` | NOTIFICACIONES@popularenlinea.com | Notificaciones Pagos al Instante transferencia enviada | Transferencia instantánea enviada. El cuerpo dice "en proceso". |
| `retiro` | notificaciones@popularenlinea.com | Notificación de Retiro | Retiro en cajero con tarjeta de débito. |
