# Email parsers (Gmail sync)

Parsers convierten el cuerpo HTML de correos bancarios en `ParsedTransaction` para crear transacciones `PENDING`.

## Dominios From vs preset Gmail `bankDomain`

| Banco   | Gmail `from:` (preset) | From real en correos                                       |
| ------- | ---------------------- | ---------------------------------------------------------- |
| BHD     | `bhd.com.do`           | `Alertas@bhd.com.do`                                       |
| Popular | `popularenlinea.com`   | `notificaciones@popularenlinea.com`                        |
| Qik     | `qik.com.do`           | `transacciones@mail.qik.com.do`, `no-reply-qik@qik.com.do` |

Usar `qik.com.do` (no solo `mail.qik.com.do`) para indexar depósitos, transferencias y pagos de servicio.

## Plantillas Qik

| Tipo                   | Subject típico                  | `type`   |
| ---------------------- | ------------------------------- | -------- |
| Depósito ACH           | depósito a tu cuenta Qik        | `CREDIT` |
| Transferencia saliente | transferencia ACH fue procesada | `DEBIT`  |
| Pago de servicio       | Pago de servicio realizado      | `DEBIT`  |

## Fixtures y tests

Muestras en `__fixtures__/*.txt` (headers + HTML). Tests: `email-parsers.spec.ts`.

```bash
npm test -- email-parsers.spec.ts
```

## Añadir un banco

1. Crear `*.parser.ts` implementando `EmailParser`.
2. Registrar en `email-parser.registry.ts`.
3. Añadir fixture en `__fixtures__/` y caso en `email-parsers.spec.ts`.
4. Añadir preset en app `BANK_EMAIL_PRESETS` si aplica.
