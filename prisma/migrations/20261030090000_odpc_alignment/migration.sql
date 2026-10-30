-- ODPC alignment (see CHANGELOG.md, 2026-10-30). Additive only: new
-- nullable/defaulted columns, two new tables, new enum values. No existing
-- row is changed or removed. Undo: prisma/rollback/20261030090000_odpc_alignment.down.sql

-- AlterEnum
ALTER TYPE "ConsentType" ADD VALUE 'CLINIC_RECORD_ACCESS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OtpPurpose" ADD VALUE 'PHONE_VERIFICATION';
ALTER TYPE "OtpPurpose" ADD VALUE 'IN_PERSON_SETUP';

-- AlterEnum
ALTER TYPE "LegalDocument" ADD VALUE 'CONFIDENTIALITY_UNDERTAKING';

-- AlterEnum
ALTER TYPE "LegalAcceptanceContext" ADD VALUE 'STAFF_SIGNUP';

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "email" TEXT;

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "feeRestrictedAt" TIMESTAMP(3),
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "phoneVerifiedVia" TEXT;

-- AlterTable
ALTER TABLE "consents" ADD COLUMN     "clinicId" TEXT,
ADD COLUMN     "staffId" TEXT;

-- AlterTable
ALTER TABLE "check_ins" ADD COLUMN     "feeSettledAt" TIMESTAMP(3),
ADD COLUMN     "feeSettledByCheckInId" TEXT,
ADD COLUMN     "includesOutstandingKes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "queuedBeforePaymentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "reminderSmsSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "clinicId" TEXT;

-- CreateTable
CREATE TABLE "pending_patient_signups" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "sex" "Sex" NOT NULL DEFAULT 'UNKNOWN',
    "email" TEXT,
    "idType" "PatientIdType",
    "idNumber" TEXT,
    "nextOfKinName" TEXT,
    "nextOfKinPhone" TEXT,
    "pinHash" TEXT NOT NULL,
    "crossClinicConsent" BOOLEAN NOT NULL DEFAULT false,
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_patient_signups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_access_requests" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "requestedByStaffId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "codeExpiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByStaffId" TEXT,
    "accessUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_patient_signups_phoneNumber_idx" ON "pending_patient_signups"("phoneNumber");

-- CreateIndex
CREATE INDEX "pending_patient_signups_expiresAt_idx" ON "pending_patient_signups"("expiresAt");

-- CreateIndex
CREATE INDEX "record_access_requests_patientId_clinicId_idx" ON "record_access_requests"("patientId", "clinicId");

-- CreateIndex
CREATE INDEX "audit_logs_clinicId_createdAt_idx" ON "audit_logs"("clinicId", "createdAt");

