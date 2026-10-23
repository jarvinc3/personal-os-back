# Quick start

## Requisitos

- Node.js 20+
- pnpm
- PostgreSQL (Supabase) + Auth
- Redis opcional en local; obligatorio en production
- Al menos una API key: `GROQ_API_KEY`, `OPENCODE_API_KEY` o `OPENROUTER_API_KEY`

```bash
cd personal-os-back
cp .env.example .env
pnpm install
pnpm db:generate
pnpm start:dev
```

- API: `http://localhost:$PORT/api` (`.env.example` y el default del schema Zod usan `PORT=3100`)
- Swagger: `http://localhost:$PORT/docs` (off en production)
- Bull Board: `http://localhost:$PORT/admin/queues` (solo development + Redis)

Detalle de env: [environment.md](./environment.md).
