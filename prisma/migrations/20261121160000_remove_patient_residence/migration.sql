-- Patient residence (sub-county, ward, village) is not collected: it is not in the Privacy Notice,
-- the DPIA or the ODPC registration (owner, 21 Nov 2026). Drops the columns added by
-- 20261121130000_residence_family_history_dispensing, and whatever was typed into them.
-- Undo (empty columns only): prisma/rollback/20261121160000_remove_patient_residence.down.sql

-- AlterTable
ALTER TABLE "patients" DROP COLUMN "subCounty",
DROP COLUMN "village",
DROP COLUMN "ward";

