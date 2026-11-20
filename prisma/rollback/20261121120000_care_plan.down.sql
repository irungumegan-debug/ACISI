-- Undo for prisma/migrations/20261121120000_care_plan. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261121120000_care_plan.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261121120000_care_plan'"
--
-- Deletes every visit's plan / follow-up text.

BEGIN;
ALTER TABLE "encounters" DROP COLUMN IF EXISTS "carePlan";
COMMIT;
