-- Undo for prisma/migrations/20261121140000_surveillance_email. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261121140000_surveillance_email.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261121140000_surveillance_email'"
--
-- Forgets each clinic's surveillance coordinator email (emailed reports stop).

BEGIN;
ALTER TABLE "clinics" DROP COLUMN IF EXISTS "surveillanceEmail", DROP COLUMN IF EXISTS "surveillanceWeeklySentFor";
COMMIT;
