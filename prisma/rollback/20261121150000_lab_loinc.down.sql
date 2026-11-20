-- Undo for prisma/migrations/20261121150000_lab_loinc. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261121150000_lab_loinc.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261121150000_lab_loinc'"
--
-- Forgets the LOINC codes set on lab tests and ordered tests.

BEGIN;
ALTER TABLE "lab_tests" DROP COLUMN IF EXISTS "loincCode";
ALTER TABLE "lab_order_items" DROP COLUMN IF EXISTS "loincCode";
COMMIT;
