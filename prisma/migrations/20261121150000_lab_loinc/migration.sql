-- LOINC code per lab test, copied onto each ordered test. Additive only: two nullable columns.
-- Undo: prisma/rollback/20261121150000_lab_loinc.down.sql

-- AlterTable
ALTER TABLE "lab_tests" ADD COLUMN     "loincCode" TEXT;

-- AlterTable
ALTER TABLE "lab_order_items" ADD COLUMN     "loincCode" TEXT;

