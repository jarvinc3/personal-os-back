# Email Intelligence (AI-2)

`/api/intelligence` exposes the Gmail source and its imported messages to the authenticated account. OAuth requests Gmail read-only scope; signed state binds the callback to the initiating user. Access and refresh tokens are encrypted with the dedicated `AI_GMAIL_TOKEN_ENCRYPTION_KEY`.

The first sync paginates from 2026-01-01. Later syncs use the persisted Gmail history cursor; an expired cursor triggers a bounded seven-day search. The dashboard marks the bootstrap complete only after Gmail returns the last page and includes the earliest and latest persisted message dates. The messages endpoint paginates oldest-first so the historical start is visible immediately. Message identity is unique per connection and provider message ID, so retries do not duplicate rows. All message reads filter by `userId`; a composite foreign key keeps a message attached to its owner's connection.

Sync progress is persisted on the user's connection so refreshes can recover its current stage, page counters, retry wait, next scheduled tick, and safe failure category. The authenticated notifications socket emits `ai.email.sync.updated` to the owning user's room; the REST dashboard remains the durable snapshot. The scheduler resumes the next bootstrap page every configured interval (10 minutes by default), so a completed page with more history is shown as scheduled rather than stopped.

Gmail quota errors honor the provider's `Retry-After` value, bounded between 1 and 30 seconds. When Gmail omits it, the backend shows a visible exponential wait of 5, 10, and 20 seconds before its three retries. If the quota remains exhausted, the connection stays in `waiting` and schedules another automatic attempt after 1, 2, 4, 8, then at most 15 minutes; the retry time is persisted and resumed after a worker restart. The incremental history read uses the same retries and retry states as the rest of the Gmail calls.

Errors are classified as `configuration`, `authorization`, `rate_limit`, `temporary` or `unknown`. The safe provider code is kept in `errorCode` (or in `providerErrorCode` when a retry is scheduled) so the dashboard can show a concrete cause: `gmail_oauth_not_configured` stays a configuration error, `401`/`403`/`insufficientPermissions` become authorization errors, and an unrecognized provider code remains available instead of a generic exception message. A worker restart mid-run is recorded as `worker_interrupted`.

Endpoints:

- `GET /api/intelligence`: connection, counts, current role, and first/latest received-message dates.
- `GET /api/intelligence/messages?cursor=...`: keyset-paginated summaries ordered oldest-first.
- `GET /api/intelligence/messages/:messageId`: the caller's message and available body representations.
- `POST /api/intelligence/email/connect` and `POST /api/intelligence/email/sync`.
- `POST /api/intelligence/email/reset` with `{ "confirmed": true }` removes this user's imported mail and derived review/analysis data, resets bootstrap cursors, and retains the OAuth connection.
- `GET /api/intelligence/email/oauth/callback`: public OAuth callback; the signed state is validated before persisting tokens.
- `GET|PATCH /api/ai/preferences/consent`: contribution consent, enabled by default and revocable. Revoking it pauses GLOBAL knowledge and rebuilds the projection.
- `GET /api/ai/admin/roles` and `PATCH /api/ai/admin/roles/:userId`: ADMIN-only role management.

Raw message bodies are purged 30 days after ingestion in DEV and 7 days after ingestion in PROD; canonical and sanitized representations remain available for this phase. New tables enable RLS and revoke `PUBLIC`, `anon`, and `authenticated` access where those roles exist. The backend accesses them through Prisma.

Configure `AI_GMAIL_CLIENT_ID`, `AI_GMAIL_CLIENT_SECRET`, `AI_GMAIL_REDIRECT_URI`, and the dedicated 32-character `AI_GMAIL_TOKEN_ENCRYPTION_KEY` in DEV. Set `AI_DEV_ADMIN_EMAIL` to seed the development administrator. This configuration is not applied to production as part of AI-2.
