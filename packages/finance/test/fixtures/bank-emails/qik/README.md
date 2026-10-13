# Qik Banco Digital: correos de ejemplo

Fixtures reales anonimizados, sacados de Gmail el 13/10/2026. Cuentas y tarjetas están enmascaradas con los últimos 4 dígitos. Montos, terceros, números de confirmación, referencias, emails y teléfonos personales son ficticios. Se conservan el remitente, el asunto, la estructura HTML, los ids y los formatos de fecha. En `expected` de cada `.json` están los campos extraídos esperados.

| Tipo | Remitente | Asunto | Para qué sirve |
|---|---|---|---|
| `deposito-recibido` | transacciones@mail.qik.com.do | Jarvin Andres, has recibido un depósito a tu cuenta Qik. | Depósito ACH recibido en la cuenta Qik. |
| `toke-recibido` | no-reply-qik@qik.com.do | 💵 Te han enviado un Toke | Toke (P2P) recibido en la cuenta Qik. |
