-- Demo clinics were removed from the app again: the demo is a standalone,
-- downloadable file, not part of acisi.co.ke. Undoes
-- 20261013090000_demo_clinics_v2; on a database that never ran it, the two
-- run back to back and cancel out.

-- DropForeignKey
ALTER TABLE "patients" DROP CONSTRAINT IF EXISTS "patients_demoClinicId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "clinics_demoKey_key";

-- AlterTable
ALTER TABLE "patients" DROP COLUMN IF EXISTS "demoClinicId";

-- AlterTable
ALTER TABLE "clinics" DROP COLUMN IF EXISTS "demoConfig",
DROP COLUMN IF EXISTS "demoKey",
DROP COLUMN IF EXISTS "isDemo";
