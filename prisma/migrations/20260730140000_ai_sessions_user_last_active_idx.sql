-- Align schema: AI sessions list index (transfer_group_id partial already applied earlier).
CREATE INDEX IF NOT EXISTS "ai_agent_sessions_user_id_last_active_idx"
ON "ai_agent_sessions" ("user_id", "last_active_at");
