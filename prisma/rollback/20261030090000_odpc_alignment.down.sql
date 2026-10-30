-- Undo for prisma/migrations/20261030090000_odpc_alignment. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261030090000_odpc_alignment.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261030090000_odpc_alignment'"
--
-- It removes only what that migration added, so data that existed before it
-- is untouched. Data written into the new columns/tables since (phone
-- verification dates, staff emails, record requests, pending signups) is
-- lost; take a backup first (sudo systemctl start acisi-backup).
--
-- The new enum values (CLINIC_RECORD_ACCESS, PHONE_VERIFICATION,
-- IN_PERSON_SETUP, CONFIDENTIALITY_UNDERTAKING, STAFF_SIGNUP) are left in
-- place: PostgreSQL cannot drop an enum value without rewriting the
-- column, and an unused value does no harm to the older app.

BEGIN;
DROP INDEX IF EXISTS "audit_logs_clinicId_createdAt_idx";
ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "clinicId";
ALTER TABLE "staff" DROP COLUMN IF EXISTS "email";
ALTER TABLE "patients" DROP COLUMN IF EXISTS "feeRestrictedAt",
  DROP COLUMN IF EXISTS "phoneVerifiedAt",
  DROP COLUMN IF EXISTS "phoneVerifiedVia";
ALTER TABLE "consents" DROP COLUMN IF EXISTS "clinicId",
  DROP COLUMN IF EXISTS "staffId";
ALTER TABLE "check_ins" DROP COLUMN IF EXISTS "feeSettledAt",
  DROP COLUMN IF EXISTS "feeSettledByCheckInId",
  DROP COLUMN IF EXISTS "includesOutstandingKes",
  DROP COLUMN IF EXISTS "queuedBeforePaymentAt";
ALTER TABLE "appointments" DROP COLUMN IF EXISTS "reminderSmsSentAt";
DROP TABLE IF EXISTS "pending_patient_signups";
DROP TABLE IF EXISTS "record_access_requests";
COMMIT;
