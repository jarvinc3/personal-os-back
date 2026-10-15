-- The default warning window of the Suscripciones view moved from 3 to 5 days.
-- Saved modules keep their stored value, so the rows still holding the old
-- default move to the new one once; any other value chosen by hand is kept.

UPDATE "user_modules"
SET "config" = jsonb_set(
  "config",
  '{subscriptions,reminderDaysBefore}',
  '5'::jsonb
)
WHERE "config" #>> '{subscriptions,reminderDaysBefore}' = '3';
