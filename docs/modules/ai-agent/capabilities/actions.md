# Capacidad: actions

Estados Prisma `AiActionStatus`: `PENDING`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELLED`.

- `POST /api/ai/actions/:id/execute` — ejecuta PENDING
- `POST /api/ai/actions/:id/cancel`
- Reaper: cada 5 minutos marca `RUNNING` > 15 min

Evidencia: `actions/application/AiActionsService`, `AiActionsReaperService`.
