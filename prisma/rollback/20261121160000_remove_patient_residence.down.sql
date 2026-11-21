-- Undo for prisma/migrations/20261121160000_remove_patient_residence. NOT run
-- automatically. Puts the three columns back, empty (what they held is gone):
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261121160000_remove_patient_residence.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261121160000_remove_patient_residence'"

BEGIN;
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "subCounty" TEXT, ADD COLUMN IF NOT EXISTS "ward" TEXT, ADD COLUMN IF NOT EXISTS "village" TEXT;
COMMIT;
