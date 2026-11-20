-- Doctor's orders besides medicines and lab tests: radiology, physiotherapy, occupational therapy,
-- nutrition, social work, counselling. Additive only. Undo: prisma/rollback/20261121090000_service_orders.down.sql

-- CreateEnum
CREATE TYPE "ServiceOrderCategory" AS ENUM ('RADIOLOGY', 'PHYSIOTHERAPY', 'OCCUPATIONAL_THERAPY', 'NUTRITION', 'SOCIAL_WORK', 'COUNSELLING');

-- CreateEnum
CREATE TYPE "ServiceOrderStatus" AS ENUM ('REQUESTED', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "service_orders" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "category" "ServiceOrderCategory" NOT NULL,
    "orderDescription" TEXT NOT NULL,
    "orderNote" TEXT,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "status" "ServiceOrderStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedByStaffId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedByStaffId" TEXT,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "service_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_orders_encounterId_idx" ON "service_orders"("encounterId");

-- CreateIndex
CREATE INDEX "service_orders_clinicId_status_idx" ON "service_orders"("clinicId", "status");

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

