-- Undo for prisma/migrations/20261031090000_clinic_sms_usage. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261031090000_clinic_sms_usage.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261031090000_clinic_sms_usage'"
--
-- Removes only what that migration added: the SMS counts and each clinic's
-- plan and allowance. Nothing that existed before is touched.

BEGIN;
DROP TABLE IF EXISTS "clinic_sms_messages";
ALTER TABLE "clinics" DROP COLUMN IF EXISTS "plan",
  DROP COLUMN IF EXISTS "smsMonthlyAllowance";
DROP TYPE IF EXISTS "ClinicPlan";
COMMIT;
