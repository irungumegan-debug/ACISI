-- Undo for prisma/migrations/20261120180000_hie_visits. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261120180000_hie_visits.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261120180000_hie_visits'"
--
-- Forgets which visits were linked to the national Shared Health Record
-- (what was already sent stays at DHA).

BEGIN;
DROP TABLE IF EXISTS "hie_visits";
DROP TYPE IF EXISTS "HieCloseStatus";
DROP TYPE IF EXISTS "HieSendStatus";
DROP TYPE IF EXISTS "HieConsentStatus";
COMMIT;
