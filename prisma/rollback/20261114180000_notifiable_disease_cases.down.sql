-- Undo for prisma/migrations/20261114180000_notifiable_disease_cases. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261114180000_notifiable_disease_cases.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261114180000_notifiable_disease_cases'"
--
-- Deletes the notifiable-disease case list (the visits and diagnoses stay).

BEGIN;
DROP TABLE IF EXISTS "notifiable_disease_cases";
DROP TYPE IF EXISTS "NotifiableReporting";
COMMIT;
