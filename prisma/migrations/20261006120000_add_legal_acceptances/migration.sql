-- CreateEnum
CREATE TYPE "LegalDocument" AS ENUM ('PRIVACY_NOTICE', 'TERMS_OF_SERVICE');

-- CreateEnum
CREATE TYPE "LegalAcceptanceContext" AS ENUM ('PATIENT_SIGNUP', 'PATIENT_PORTAL_LOGIN', 'PATIENT_WEB_CHECKIN', 'WALK_IN_CHECKIN', 'CLINIC_REGISTRATION', 'STAFF_LOGIN');

-- CreateTable
CREATE TABLE "legal_acceptances" (
    "id" TEXT NOT NULL,
    "document" "LegalDocument" NOT NULL,
    "version" TEXT NOT NULL,
    "context" "LegalAcceptanceContext" NOT NULL,
    "patientId" TEXT,
    "staffId" TEXT,
    "clinicId" TEXT,
    "checkInId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_acceptances_patientId_document_idx" ON "legal_acceptances"("patientId", "document");

-- CreateIndex
CREATE INDEX "legal_acceptances_staffId_document_idx" ON "legal_acceptances"("staffId", "document");

-- CreateIndex
CREATE INDEX "legal_acceptances_clinicId_idx" ON "legal_acceptances"("clinicId");

-- AddForeignKey
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "check_ins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

