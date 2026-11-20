-- The doctor's plan / follow-up on a visit. Additive only: one nullable column.
-- Undo: prisma/rollback/20261121120000_care_plan.down.sql

-- AlterTable
ALTER TABLE "encounters" ADD COLUMN     "carePlan" TEXT;

