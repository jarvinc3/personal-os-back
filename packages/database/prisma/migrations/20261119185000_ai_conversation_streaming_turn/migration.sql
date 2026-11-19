-- Turno idempotente del chat (#421), aplicado el 2026-11-19.
-- El cliente repite un envío con el mismo client_message_id y el back reutiliza
-- el mensaje del usuario en vez de duplicarlo. El índice único permite una fila
-- USER y otra ASSISTANT con la misma clave; los turnos sin clave quedan NULL y
-- no colisionan entre sí.
ALTER TABLE "ai_conversation_messages" ADD COLUMN "client_message_id" TEXT;
ALTER TABLE "ai_conversation_messages" ADD COLUMN "provider" TEXT;
ALTER TABLE "ai_conversation_messages" ADD COLUMN "model" TEXT;

CREATE UNIQUE INDEX "ai_conversation_messages_turn_key"
  ON "ai_conversation_messages" ("conversation_id", "client_message_id", "role");
