-- Undo for prisma/migrations/20261126100000_sha_addon_switch. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261126100000_sha_addon_switch.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261126100000_sha_addon_switch'"
--
-- Forgets which clinics had the SHA add-on switched on.

BEGIN;
ALTER TABLE "clinics" DROP COLUMN IF EXISTS "shaAddonChangedAt";
ALTER TABLE "clinics" DROP COLUMN IF EXISTS "shaAddonEnabled";
COMMIT;
