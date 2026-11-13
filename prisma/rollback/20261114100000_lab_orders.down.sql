-- Undo for prisma/migrations/20261114100000_lab_orders. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261114100000_lab_orders.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261114100000_lab_orders'"
--
-- Removes the lab test lists, every lab order and its results. Visits that
-- were at the lab go back to "with the doctor"; lab technicians are
-- deactivated (the previous version has no such role). Files the lab
-- attached stay on the patient's record, just no longer linked to an order.
-- The new enum values (LAB_TECHNICIAN, AWAITING_LAB) stay in place:
-- PostgreSQL cannot drop an enum value without rewriting the type, and an
-- unused value is harmless.

BEGIN;
UPDATE "encounters" SET "status" = 'IN_CONSULTATION' WHERE "status" = 'AWAITING_LAB';
UPDATE "staff" SET "role" = 'RECEPTIONIST', "isActive" = false WHERE "role" = 'LAB_TECHNICIAN';
ALTER TABLE "patient_files" DROP CONSTRAINT IF EXISTS "patient_files_labOrderId_fkey";
DROP INDEX IF EXISTS "patient_files_labOrderId_idx";
ALTER TABLE "patient_files" DROP COLUMN IF EXISTS "labOrderId";
DROP TABLE IF EXISTS "lab_order_items";
DROP TABLE IF EXISTS "lab_orders";
DROP TABLE IF EXISTS "lab_tests";
DROP TYPE IF EXISTS "LabResultFlag";
DROP TYPE IF EXISTS "LabOrderStatus";
COMMIT;
