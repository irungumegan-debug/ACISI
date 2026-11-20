-- DHA Health Information Exchange registries (facility, health worker, client).
-- Additive only: nullable columns. Undo: prisma/rollback/20261120150000_hie_registries.down.sql

-- AlterTable
ALTER TABLE "clinics" ADD COLUMN "hieFacilityId" TEXT,
ADD COLUMN "hieFacilityName" TEXT,
ADD COLUMN "hieFacilityVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "staff" ADD COLUMN "hieRegulator" TEXT,
ADD COLUMN "hieRegistrationNumber" TEXT,
ADD COLUMN "hiePractitionerId" TEXT,
ADD COLUMN "hieRegisteredName" TEXT,
ADD COLUMN "hieLicenceEnd" TIMESTAMP(3),
ADD COLUMN "hieVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "patients" ADD COLUMN "hieCrId" TEXT,
ADD COLUMN "hieCrSourceHash" TEXT,
ADD COLUMN "hieCrVerifiedAt" TIMESTAMP(3);
