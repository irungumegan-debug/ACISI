-- Undo for prisma/migrations/20261114230000_public_health_events. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261114230000_public_health_events.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261114230000_public_health_events'"
--
-- Deletes the recorded public health events.

BEGIN;
DROP TABLE IF EXISTS "public_health_events";
DROP TYPE IF EXISTS "PublicHealthEventType";
COMMIT;
