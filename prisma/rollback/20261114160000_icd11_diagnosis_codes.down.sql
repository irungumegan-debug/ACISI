-- Undo for prisma/migrations/20261114160000_icd11_diagnosis_codes. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261114160000_icd11_diagnosis_codes.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261114160000_icd11_diagnosis_codes'"
--
-- Removes the ICD-11 codes from visits. The doctors' diagnosis notes stay.

BEGIN;
ALTER TABLE "encounters" DROP COLUMN IF EXISTS "diagnosisCodes";
COMMIT;
