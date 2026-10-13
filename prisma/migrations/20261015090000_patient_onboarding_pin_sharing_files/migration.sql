-- CreateEnum
CREATE TYPE "ClinicPatientSource" AS ENUM ('ADDED', 'IMPORTED', 'VISIT');

-- CreateEnum
CREATE TYPE "RecordAccessStatus" AS ENUM ('PENDING', 'APPROVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RecordAccessMethod" AS ENUM ('SMS_CODE', 'PATIENT_PIN');

-- CreateEnum
CREATE TYPE "PatientFileCategory" AS ENUM ('XRAY', 'CT_SCAN', 'MRI', 'ULTRASOUND', 'LAB_REPORT', 'PREVIOUS_RECORDS', 'OTHER');

-- AlterEnum
ALTER TYPE "ConsentType" ADD VALUE 'CLINIC_RECORD_ACCESS';

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'FIRST_LOGIN';

-- DropIndex
DROP INDEX "patients_phoneNumber_key";

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "clinicId" TEXT,
ADD COLUMN     "patientId" TEXT;

-- AlterTable
ALTER TABLE "consents" ADD COLUMN     "clinicId" TEXT;

-- AlterTable
ALTER TABLE "encounters" ADD COLUMN     "queueJoinSmsAt" TIMESTAMP(3),
ADD COLUMN     "queueNextSmsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "dateOfBirthEstimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "idSavedAt" TIMESTAMP(3),
ADD COLUMN     "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinLockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "phone_otps" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_patients" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "source" "ClinicPatientSource" NOT NULL,
    "addedByStaffId" TEXT,
    "invitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_access_requests" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "requestedByStaffId" TEXT NOT NULL,
    "codeHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "RecordAccessStatus" NOT NULL DEFAULT 'PENDING',
    "approvedBy" "RecordAccessMethod",
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_files" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicId" TEXT,
    "uploadedByType" "ActorType" NOT NULL,
    "uploadedByStaffId" TEXT,
    "category" "PatientFileCategory" NOT NULL,
    "documentDate" DATE NOT NULL,
    "note" TEXT,
    "storageName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "phone_otps_phoneNumber_createdAt_idx" ON "phone_otps"("phoneNumber", "createdAt");

-- CreateIndex
CREATE INDEX "clinic_patients_patientId_idx" ON "clinic_patients"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_patients_clinicId_patientId_key" ON "clinic_patients"("clinicId", "patientId");

-- CreateIndex
CREATE INDEX "record_access_requests_patientId_clinicId_idx" ON "record_access_requests"("patientId", "clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "patient_files_storageName_key" ON "patient_files"("storageName");

-- CreateIndex
CREATE INDEX "patient_files_patientId_idx" ON "patient_files"("patientId");

-- CreateIndex
CREATE INDEX "patient_files_clinicId_idx" ON "patient_files"("clinicId");

-- CreateIndex
CREATE INDEX "audit_logs_patientId_createdAt_idx" ON "audit_logs"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_clinicId_createdAt_idx" ON "audit_logs"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "consents_patientId_type_clinicId_idx" ON "consents"("patientId", "type", "clinicId");

-- CreateIndex
CREATE INDEX "patients_phoneNumber_idx" ON "patients"("phoneNumber");

-- AddForeignKey
ALTER TABLE "clinic_patients" ADD CONSTRAINT "clinic_patients_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_patients" ADD CONSTRAINT "clinic_patients_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_patients" ADD CONSTRAINT "clinic_patients_addedByStaffId_fkey" FOREIGN KEY ("addedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_access_requests" ADD CONSTRAINT "record_access_requests_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_access_requests" ADD CONSTRAINT "record_access_requests_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_access_requests" ADD CONSTRAINT "record_access_requests_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_files" ADD CONSTRAINT "patient_files_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_files" ADD CONSTRAINT "patient_files_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_files" ADD CONSTRAINT "patient_files_uploadedByStaffId_fkey" FOREIGN KEY ("uploadedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Data backfill (no data is changed or removed — only new columns/rows filled)
-- ---------------------------------------------------------------------------

-- Every clinic keeps access to the patients it has already seen.
INSERT INTO "clinic_patients" ("id", "clinicId", "patientId", "source", "createdAt")
SELECT 'cp_' || md5(c."clinicId" || ':' || c."patientId"), c."clinicId", c."patientId", 'VISIT', MIN(c."createdAt")
FROM "check_ins" c
GROUP BY c."clinicId", c."patientId"
ON CONFLICT ("clinicId", "patientId") DO NOTHING;

-- Dates of birth worked out from an age were stored as 1 January of the
-- birth year, so for those only the year is known.
UPDATE "patients"
SET "dateOfBirthEstimated" = true
WHERE "dateOfBirth" IS NOT NULL
  AND EXTRACT(MONTH FROM "dateOfBirth") = 1
  AND EXTRACT(DAY FROM "dateOfBirth") = 1;

-- Fill the new audit columns from what older rows already recorded.
UPDATE "audit_logs"
SET "patientId" = "entityId"
WHERE "entityType" = 'Patient' AND "patientId" IS NULL;

UPDATE "audit_logs"
SET "clinicId" = COALESCE("metadata"->>'clinicId', "metadata"->>'viewedByClinicId')
WHERE "clinicId" IS NULL
  AND "metadata" IS NOT NULL
  AND COALESCE("metadata"->>'clinicId', "metadata"->>'viewedByClinicId') IS NOT NULL;
