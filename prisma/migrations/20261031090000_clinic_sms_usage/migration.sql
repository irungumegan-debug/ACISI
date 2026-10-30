-- C24 SMS count per clinic (see CHANGELOG.md). Additive only: a plan and an
-- SMS allowance on each clinic (existing clinics: Starter, 500), and a table
-- of counted SMS. Undo: prisma/rollback/20261031090000_clinic_sms_usage.down.sql

-- CreateEnum
CREATE TYPE "ClinicPlan" AS ENUM ('STARTER', 'CLINIC', 'CLINIC_PLUS');

-- AlterTable
ALTER TABLE "clinics" ADD COLUMN     "plan" "ClinicPlan" NOT NULL DEFAULT 'STARTER',
ADD COLUMN     "smsMonthlyAllowance" INTEGER NOT NULL DEFAULT 500;

-- CreateTable
CREATE TABLE "clinic_sms_messages" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "parts" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinic_sms_messages_clinicId_sentAt_idx" ON "clinic_sms_messages"("clinicId", "sentAt");

