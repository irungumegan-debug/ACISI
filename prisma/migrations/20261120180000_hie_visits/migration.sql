-- DHA Shared Health Record: one row per visit linked to the national HIE (consent, sending, closing).
-- Additive only: three enums and one table. Undo: prisma/rollback/20261120180000_hie_visits.down.sql

-- CreateEnum
CREATE TYPE "HieConsentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "HieSendStatus" AS ENUM ('NOT_SENT', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "HieCloseStatus" AS ENUM ('OPEN', 'CODE_SENT', 'CLOSED');

-- CreateTable
CREATE TABLE "hie_visits" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "consentId" TEXT,
    "otpRecord" TEXT,
    "consentStatus" "HieConsentStatus" NOT NULL DEFAULT 'PENDING',
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "hieVisitId" TEXT,
    "consentToken" TEXT,
    "consentDecidedAt" TIMESTAMP(3),
    "requestedByStaffId" TEXT NOT NULL,
    "bundleId" TEXT,
    "sendStatus" "HieSendStatus" NOT NULL DEFAULT 'NOT_SENT',
    "sendAttempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "closeStatus" "HieCloseStatus" NOT NULL DEFAULT 'OPEN',
    "closeOtpRecord" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hie_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hie_visits_encounterId_key" ON "hie_visits"("encounterId");

-- CreateIndex
CREATE INDEX "hie_visits_clinicId_closeStatus_idx" ON "hie_visits"("clinicId", "closeStatus");

-- AddForeignKey
ALTER TABLE "hie_visits" ADD CONSTRAINT "hie_visits_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

