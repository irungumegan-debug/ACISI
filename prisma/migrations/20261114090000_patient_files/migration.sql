-- Patient file uploads (X-rays, scans, lab reports, photos of paper records).
-- Additive only: one new enum and one new table. Undo: prisma/rollback/20261114090000_patient_files.down.sql

-- CreateEnum
CREATE TYPE "PatientFileCategory" AS ENUM ('XRAY', 'CT_SCAN', 'MRI', 'ULTRASOUND', 'LAB_REPORT', 'PREVIOUS_RECORDS', 'OTHER');

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
CREATE UNIQUE INDEX "patient_files_storageName_key" ON "patient_files"("storageName");

-- CreateIndex
CREATE INDEX "patient_files_patientId_idx" ON "patient_files"("patientId");

-- CreateIndex
CREATE INDEX "patient_files_clinicId_idx" ON "patient_files"("clinicId");

-- AddForeignKey
ALTER TABLE "patient_files" ADD CONSTRAINT "patient_files_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_files" ADD CONSTRAINT "patient_files_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_files" ADD CONSTRAINT "patient_files_uploadedByStaffId_fkey" FOREIGN KEY ("uploadedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

