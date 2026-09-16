# Testing

| Tipo | Cómo | Alcance |
| --- | --- | --- |
| Unit | `pnpm test` | Specs junto al unit (`*.spec.ts`) |
| E2E | `pnpm test:e2e` | `test/*.e2e-spec.ts` — Prisma mock / auth test providers |

Auth e2e: `test/helpers/auth-test.providers.ts` (HS256 overrides). **Nunca** `NODE_ENV=test` sobre el path de auth de production.

Finance HTTP smoke documentado históricamente (`prisma/scripts/smoke-finance-http.ts`) no está en el repo — REV-BACK-005. Sustituto automatizado: `pnpm test:e2e --testPathPatterns=finance`.
