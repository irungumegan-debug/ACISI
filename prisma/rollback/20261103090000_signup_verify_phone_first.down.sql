-- Undo for prisma/migrations/20261103090000_signup_verify_phone_first. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261103090000_signup_verify_phone_first.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261103090000_signup_verify_phone_first'"
--
-- Pending signups that have no PIN yet (started under the new order) can't
-- exist under the old rules, so they are deleted; the patient simply signs
-- up again. Nothing else is touched.

BEGIN;
DELETE FROM "pending_patient_signups" WHERE "pinHash" IS NULL;
ALTER TABLE "pending_patient_signups" DROP COLUMN IF EXISTS "pinSetupExpiresAt";
ALTER TABLE "pending_patient_signups" DROP COLUMN IF EXISTS "pinSetupTokenHash";
ALTER TABLE "pending_patient_signups" DROP COLUMN IF EXISTS "phoneVerifiedAt";
ALTER TABLE "pending_patient_signups" ALTER COLUMN "pinHash" SET NOT NULL;
COMMIT;
