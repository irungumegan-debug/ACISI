-- Undo for prisma/migrations/20261114120000_audit_log_tamper_resistant. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261114120000_audit_log_tamper_resistant.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261114120000_audit_log_tamper_resistant'"
--
-- Removes the append-only protection and the hash chain. No audit row is
-- deleted; only the two hash columns are dropped.

BEGIN;
DROP TRIGGER IF EXISTS audit_logs_no_truncate ON "audit_logs";
DROP TRIGGER IF EXISTS audit_logs_no_update ON "audit_logs";
DROP TRIGGER IF EXISTS audit_logs_chain ON "audit_logs";
DROP FUNCTION IF EXISTS audit_logs_refuse_change();
DROP FUNCTION IF EXISTS audit_logs_chain();
DROP FUNCTION IF EXISTS audit_log_row_text("audit_logs");
ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "hash";
ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "prevHash";
COMMIT;
