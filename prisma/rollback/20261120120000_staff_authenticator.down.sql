-- Undo for prisma/migrations/20261120120000_staff_authenticator. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261120120000_staff_authenticator.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261120120000_staff_authenticator'"
--
-- Forgets every staff member's authenticator app (they set it up again at next login).

BEGIN;
ALTER TABLE "staff" DROP COLUMN IF EXISTS "totpEnabledAt";
ALTER TABLE "staff" DROP COLUMN IF EXISTS "totpSecret";
COMMIT;
