-- Undo for prisma/migrations/20261121100000_vital_signs. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261121100000_vital_signs.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261121100000_vital_signs'"
--
-- Deletes every recorded set of vital signs.

BEGIN;
DROP TABLE IF EXISTS "vital_signs";
COMMIT;
