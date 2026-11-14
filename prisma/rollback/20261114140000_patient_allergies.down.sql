-- Undo for prisma/migrations/20261114140000_patient_allergies. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261114140000_patient_allergies.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261114140000_patient_allergies'"
--
-- Deletes every recorded allergy. Nothing else is touched.

BEGIN;
DROP TABLE IF EXISTS "patient_allergies";
DROP TYPE IF EXISTS "AllergySeverity";
DROP TYPE IF EXISTS "AllergyCategory";
COMMIT;
