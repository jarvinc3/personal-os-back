# Email Intelligence (AI-2)

`/api/intelligence` exposes the Gmail source and its imported messages to the authenticated account. OAuth requests Gmail read-only scope; signed state binds the callback to the initiating user. Access and refresh tokens are encrypted with the dedicated `AI_GMAIL_TOKEN_ENCRYPTION_KEY`.

The first sync paginates from 2026-01-01. Later syncs use the persisted Gmail history cursor; an expired cursor triggers a bounded seven-day search. Message identity is unique per connection and provider message ID, so retries do not duplicate rows. All message reads filter by `userId`; a composite foreign key keeps a message attached to its owner's connection.

Endpoints:

- `GET /api/intelligence`: connection, counts, and current role.
- `GET /api/intelligence/messages?cursor=...`: keyset-paginated summaries.
- `GET /api/intelligence/messages/:messageId`: the caller's message and available body representations.
- `POST /api/intelligence/email/connect` and `POST /api/intelligence/email/sync`.
- `GET /api/intelligence/email/oauth/callback`: public OAuth callback; the signed state is validated before persisting tokens.
- `GET|PATCH /api/ai/preferences/consent`: contribution consent, enabled by default and revocable.
- `GET /api/ai/admin/roles` and `PATCH /api/ai/admin/roles/:userId`: ADMIN-only role management.

Raw message bodies are purged 30 days after ingestion in DEV and 7 days after ingestion in PROD; canonical and sanitized representations remain available for this phase. New tables enable RLS and revoke `PUBLIC`, `anon`, and `authenticated` access where those roles exist. The backend accesses them through Prisma.

Configure `AI_GMAIL_CLIENT_ID`, `AI_GMAIL_CLIENT_SECRET`, `AI_GMAIL_REDIRECT_URI`, and the dedicated 32-character `AI_GMAIL_TOKEN_ENCRYPTION_KEY` in DEV. Set `AI_DEV_ADMIN_EMAIL` to seed the development administrator. This configuration is not applied to production as part of AI-2.
