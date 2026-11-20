-- Patient residence (sub-county, ward, village), family history, and dispensing at checkout.
-- Additive only: nullable columns. Undo: prisma/rollback/20261121130000_residence_family_history_dispensing.down.sql

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "familyHistory" TEXT,
ADD COLUMN     "subCounty" TEXT,
ADD COLUMN     "village" TEXT,
ADD COLUMN     "ward" TEXT;

-- AlterTable
ALTER TABLE "prescription_items" ADD COLUMN     "dispenseStatus" TEXT,
ADD COLUMN     "dispensedAt" TIMESTAMP(3),
ADD COLUMN     "dispensedByStaffId" TEXT,
ADD COLUMN     "dispensedQuantity" DOUBLE PRECISION;

