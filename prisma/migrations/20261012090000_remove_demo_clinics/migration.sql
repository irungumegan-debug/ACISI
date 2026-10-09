-- Demo clinics were removed from the app (they now live in a separate
-- demo, not on acisi.co.ke). Undoes 20261011090000_demo_clinics.

-- DropForeignKey
ALTER TABLE "patients" DROP CONSTRAINT IF EXISTS "patients_demoClinicId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "clinics_demoKey_key";

-- AlterTable
ALTER TABLE "patients" DROP COLUMN IF EXISTS "demoClinicId";

-- AlterTable
ALTER TABLE "clinics" DROP COLUMN IF EXISTS "demoKey",
DROP COLUMN IF EXISTS "isDemo";
