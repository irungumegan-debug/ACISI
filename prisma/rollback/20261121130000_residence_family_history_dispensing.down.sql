-- Undo for prisma/migrations/20261121130000_residence_family_history_dispensing.
-- NOT run automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261121130000_residence_family_history_dispensing.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261121130000_residence_family_history_dispensing'"
--
-- Deletes patients' sub-county, ward, village and family history, and what was dispensed.

BEGIN;
ALTER TABLE "patients" DROP COLUMN IF EXISTS "subCounty", DROP COLUMN IF EXISTS "ward", DROP COLUMN IF EXISTS "village", DROP COLUMN IF EXISTS "familyHistory";
ALTER TABLE "prescription_items" DROP COLUMN IF EXISTS "dispenseStatus", DROP COLUMN IF EXISTS "dispensedQuantity", DROP COLUMN IF EXISTS "dispensedAt", DROP COLUMN IF EXISTS "dispensedByStaffId";
COMMIT;
