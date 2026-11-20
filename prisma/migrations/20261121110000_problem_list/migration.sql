-- Patient problem list (ICD-11) with change history. Additive only: one enum, two tables.
-- Undo: prisma/rollback/20261121110000_problem_list.down.sql

-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'ENTERED_IN_ERROR');

-- CreateTable
CREATE TABLE "patient_problems" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "icd11Code" TEXT NOT NULL,
    "problemTitle" TEXT NOT NULL,
    "problemNote" TEXT,
    "status" "ProblemStatus" NOT NULL DEFAULT 'ACTIVE',
    "onsetDate" DATE,
    "recordedByStaffId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_problem_changes" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" "ProblemStatus" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_problem_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_problems_patientId_idx" ON "patient_problems"("patientId");

-- CreateIndex
CREATE INDEX "patient_problem_changes_problemId_idx" ON "patient_problem_changes"("problemId");

-- AddForeignKey
ALTER TABLE "patient_problem_changes" ADD CONSTRAINT "patient_problem_changes_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "patient_problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

