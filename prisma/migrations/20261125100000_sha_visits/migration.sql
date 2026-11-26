-- SHA claims, start visit: one row per visit started with SHA (patient's SMS-code consent, DHA's claim).
-- Additive only: one enum and one table. Undo: prisma/rollback/20261125100000_sha_visits.down.sql

-- CreateEnum
CREATE TYPE "ShaVisitStatus" AS ENUM ('CODE_SENT', 'STARTED');

-- CreateTable
CREATE TABLE "sha_visits" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "status" "ShaVisitStatus" NOT NULL DEFAULT 'CODE_SENT',
    "interventionCodes" TEXT[],
    "contactId" INTEGER,
    "codeSentAt" TIMESTAMP(3) NOT NULL,
    "codeSendCount" INTEGER NOT NULL DEFAULT 1,
    "requestedByStaffId" TEXT NOT NULL,
    "shaClaimId" TEXT,
    "shaVisitNumber" TEXT,
    "shaConsentToken" TEXT,
    "shaClaimStatus" TEXT,
    "shaWorkflowState" TEXT,
    "doctorAttached" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "startedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sha_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sha_visits_encounterId_key" ON "sha_visits"("encounterId");

-- CreateIndex
CREATE INDEX "sha_visits_clinicId_status_idx" ON "sha_visits"("clinicId", "status");

-- AddForeignKey
ALTER TABLE "sha_visits" ADD CONSTRAINT "sha_visits_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
