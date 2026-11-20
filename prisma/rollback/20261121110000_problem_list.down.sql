-- Undo for prisma/migrations/20261121110000_problem_list. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261121110000_problem_list.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261121110000_problem_list'"
--
-- Deletes every patient's problem list and its history.

BEGIN;
DROP TABLE IF EXISTS "patient_problem_changes";
DROP TABLE IF EXISTS "patient_problems";
DROP TYPE IF EXISTS "ProblemStatus";
COMMIT;
