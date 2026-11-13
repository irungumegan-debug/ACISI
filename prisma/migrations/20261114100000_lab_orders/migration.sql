-- Lab orders: doctor requests tests, lab enters results, patient goes back to the doctor.
-- Additive only: new role and visit status values, three new tables, one new
-- optional column on patient_files. Undo: prisma/rollback/20261114100000_lab_orders.down.sql

-- CreateEnum
CREATE TYPE "LabOrderStatus" AS ENUM ('REQUESTED', 'IN_PROGRESS', 'RESULTS_READY');

-- CreateEnum
CREATE TYPE "LabResultFlag" AS ENUM ('NORMAL', 'ABNORMAL', 'CRITICAL');

-- AlterEnum
ALTER TYPE "StaffRole" ADD VALUE 'LAB_TECHNICIAN';

-- AlterEnum
ALTER TYPE "EncounterStatus" ADD VALUE 'AWAITING_LAB';

-- AlterTable
ALTER TABLE "patient_files" ADD COLUMN     "labOrderId" TEXT;

-- CreateTable
CREATE TABLE "lab_tests" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "priceKes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_orders" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "status" "LabOrderStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedByStaffId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "noteForLab" TEXT,
    "startedByStaffId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedByStaffId" TEXT,
    "completedAt" TIMESTAMP(3),
    "patientNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "lab_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_order_items" (
    "id" TEXT NOT NULL,
    "labOrderId" TEXT NOT NULL,
    "labTestId" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "priceKes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "resultValue" TEXT,
    "resultUnit" TEXT,
    "resultFlag" "LabResultFlag",
    "resultComment" TEXT,

    CONSTRAINT "lab_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lab_tests_clinicId_idx" ON "lab_tests"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "lab_tests_clinicId_nameKey_key" ON "lab_tests"("clinicId", "nameKey");

-- CreateIndex
CREATE INDEX "lab_orders_encounterId_idx" ON "lab_orders"("encounterId");

-- CreateIndex
CREATE INDEX "lab_orders_clinicId_status_idx" ON "lab_orders"("clinicId", "status");

-- CreateIndex
CREATE INDEX "lab_order_items_labOrderId_idx" ON "lab_order_items"("labOrderId");

-- CreateIndex
CREATE INDEX "patient_files_labOrderId_idx" ON "patient_files"("labOrderId");

-- AddForeignKey
ALTER TABLE "patient_files" ADD CONSTRAINT "patient_files_labOrderId_fkey" FOREIGN KEY ("labOrderId") REFERENCES "lab_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_startedByStaffId_fkey" FOREIGN KEY ("startedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_completedByStaffId_fkey" FOREIGN KEY ("completedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_labOrderId_fkey" FOREIGN KEY ("labOrderId") REFERENCES "lab_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_labTestId_fkey" FOREIGN KEY ("labTestId") REFERENCES "lab_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

