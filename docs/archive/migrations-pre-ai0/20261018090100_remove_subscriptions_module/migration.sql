-- Suscripciones deja de ser un módulo propio: su configuración vive en Finanzas.
DELETE FROM "user_modules"
WHERE "module_id" IN (SELECT "id" FROM "modules" WHERE "slug" = 'subscriptions');

DELETE FROM "modules" WHERE "slug" = 'subscriptions';
