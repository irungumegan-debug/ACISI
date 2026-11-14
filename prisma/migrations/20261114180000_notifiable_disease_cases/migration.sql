-- Notifiable (IDSR) disease cases. Additive only: one enum and one table.
-- Undo: prisma/rollback/20261114180000_notifiable_disease_cases.down.sql

-- CreateEnum
CREATE TYPE "NotifiableReporting" AS ENUM ('IMMEDIATE', 'WEEKLY');

-- CreateTable
CREATE TABLE "notifiable_disease_cases" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "diseaseId" TEXT NOT NULL,
    "diseaseName" TEXT NOT NULL,
    "reporting" "NotifiableReporting" NOT NULL,
    "icd11Code" TEXT NOT NULL,
    "diagnosedAt" TIMESTAMP(3) NOT NULL,
    "diagnosedByStaffId" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3),
    "reportedByStaffId" TEXT,
    "reportNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifiable_disease_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifiable_disease_cases_clinicId_diagnosedAt_idx" ON "notifiable_disease_cases"("clinicId", "diagnosedAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifiable_disease_cases_encounterId_diseaseId_key" ON "notifiable_disease_cases"("encounterId", "diseaseId");

-- AddForeignKey
ALTER TABLE "notifiable_disease_cases" ADD CONSTRAINT "notifiable_disease_cases_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifiable_disease_cases" ADD CONSTRAINT "notifiable_disease_cases_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifiable_disease_cases" ADD CONSTRAINT "notifiable_disease_cases_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifiable_disease_cases" ADD CONSTRAINT "notifiable_disease_cases_diagnosedByStaffId_fkey" FOREIGN KEY ("diagnosedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifiable_disease_cases" ADD CONSTRAINT "notifiable_disease_cases_reportedByStaffId_fkey" FOREIGN KEY ("reportedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

