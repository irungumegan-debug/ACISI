-- CreateEnum
CREATE TYPE "PatientIdType" AS ENUM ('NATIONAL_ID', 'PASSPORT', 'BIRTH_CERTIFICATE', 'ALIEN_ID');

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "idNumber" TEXT,
ADD COLUMN     "idType" "PatientIdType",
ADD COLUMN     "nextOfKinName" TEXT,
ADD COLUMN     "nextOfKinPhone" TEXT;

