-- Structured prescriptions. Additive only: one table.
-- Undo: prisma/rollback/20261114200000_prescription_items.down.sql

-- CreateTable
CREATE TABLE "prescription_items" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productCode" TEXT,
    "drugName" TEXT NOT NULL,
    "doseValue" DOUBLE PRECISION NOT NULL,
    "doseUnit" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "durationDays" INTEGER,
    "quantity" DOUBLE PRECISION,
    "quantityUnit" TEXT,
    "instructionCodes" TEXT,
    "instructions" TEXT,
    "allergyOverrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescription_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prescription_items_encounterId_idx" ON "prescription_items"("encounterId");

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

