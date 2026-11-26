-- Undo for prisma/migrations/20261125100000_sha_visits. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261125100000_sha_visits.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261125100000_sha_visits'"
--
-- Forgets which visits were started with SHA (the claims stay at SHA).

BEGIN;
DROP TABLE IF EXISTS "sha_visits";
DROP TYPE IF EXISTS "ShaVisitStatus";
COMMIT;
