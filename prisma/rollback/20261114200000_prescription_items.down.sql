-- Undo for prisma/migrations/20261114200000_prescription_items. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261114200000_prescription_items.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261114200000_prescription_items'"
--
-- Deletes the structured prescription lines. Each visit's prescription text stays.

BEGIN;
DROP TABLE IF EXISTS "prescription_items";
COMMIT;
