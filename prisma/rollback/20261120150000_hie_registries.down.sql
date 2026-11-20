-- Undo for prisma/migrations/20261120150000_hie_registries. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261120150000_hie_registries.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261120150000_hie_registries'"
--
-- Forgets every facility code, practitioner ID and Client Registry ID looked up from the HIE.

BEGIN;
ALTER TABLE "clinics" DROP COLUMN IF EXISTS "hieFacilityId", DROP COLUMN IF EXISTS "hieFacilityName", DROP COLUMN IF EXISTS "hieFacilityVerifiedAt";
ALTER TABLE "staff" DROP COLUMN IF EXISTS "hieRegulator", DROP COLUMN IF EXISTS "hieRegistrationNumber", DROP COLUMN IF EXISTS "hiePractitionerId", DROP COLUMN IF EXISTS "hieRegisteredName", DROP COLUMN IF EXISTS "hieLicenceEnd", DROP COLUMN IF EXISTS "hieVerifiedAt";
ALTER TABLE "patients" DROP COLUMN IF EXISTS "hieCrId", DROP COLUMN IF EXISTS "hieCrSourceHash", DROP COLUMN IF EXISTS "hieCrVerifiedAt";
COMMIT;
