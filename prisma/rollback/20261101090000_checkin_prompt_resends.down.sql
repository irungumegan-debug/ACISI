-- Undo for prisma/migrations/20261101090000_checkin_prompt_resends. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261101090000_checkin_prompt_resends.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261101090000_checkin_prompt_resends'"
--
-- Removes only the resend counter. Nothing that existed before is touched.

BEGIN;
ALTER TABLE "check_ins" DROP COLUMN IF EXISTS "paymentPromptResends";
COMMIT;
