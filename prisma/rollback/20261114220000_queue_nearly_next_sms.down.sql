-- Undo for prisma/migrations/20261114220000_queue_nearly_next_sms. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261114220000_queue_nearly_next_sms.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261114220000_queue_nearly_next_sms'"

BEGIN;
ALTER TABLE "encounters" DROP COLUMN IF EXISTS "nearlyNextSmsAt";
COMMIT;
