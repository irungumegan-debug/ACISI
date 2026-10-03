-- CreateEnum
CREATE TYPE "MobileMoneyType" AS ENUM ('TILL', 'PAYBILL');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('UNPAID', 'PARTLY_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "BillItemKind" AS ENUM ('CONSULTATION', 'LAB', 'MEDICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'MPESA_STK', 'MPESA_MANUAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'VOIDED');

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "smsOptOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smsOptOutUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "clinic_payment_settings" (
    "clinicId" TEXT NOT NULL,
    "acceptsCash" BOOLEAN NOT NULL DEFAULT true,
    "acceptsCard" BOOLEAN NOT NULL DEFAULT false,
    "acceptsMobileMoney" BOOLEAN NOT NULL DEFAULT false,
    "mobileMoneyType" "MobileMoneyType",
    "mobileMoneyNumber" TEXT,
    "paybillAccountFormat" TEXT,
    "defaultConsultationFeeKes" INTEGER NOT NULL DEFAULT 0,
    "updatedByStaffId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_payment_settings_pkey" PRIMARY KEY ("clinicId")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "createdByStaffId" TEXT NOT NULL,
    "subtotalKes" INTEGER NOT NULL,
    "discountKes" INTEGER NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "totalKes" INTEGER NOT NULL,
    "paidKes" INTEGER NOT NULL DEFAULT 0,
    "status" "BillStatus" NOT NULL DEFAULT 'UNPAID',
    "paidAt" TIMESTAMP(3),
    "receiptSmsSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_items" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "kind" "BillItemKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amountKes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "bill_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "amountKes" INTEGER NOT NULL,
    "cashTenderedKes" INTEGER,
    "changeKes" INTEGER,
    "reference" TEXT,
    "mpesaReceiptNumber" TEXT,
    "voidedMpesaReceiptNumber" TEXT,
    "mpesaCheckoutRequestId" TEXT,
    "mpesaMerchantRequestId" TEXT,
    "phoneNumber" TEXT,
    "resultCode" INTEGER,
    "resultDesc" TEXT,
    "rawCallbackPayload" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "takenByStaffId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidedByStaffId" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bills_billNumber_key" ON "bills"("billNumber");

-- CreateIndex
CREATE UNIQUE INDEX "bills_encounterId_key" ON "bills"("encounterId");

-- CreateIndex
CREATE INDEX "bills_clinicId_createdAt_idx" ON "bills"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "bill_items_billId_idx" ON "bill_items"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_mpesaReceiptNumber_key" ON "payments"("mpesaReceiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payments_mpesaCheckoutRequestId_key" ON "payments"("mpesaCheckoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payments_billId_idx" ON "payments"("billId");

-- CreateIndex
CREATE INDEX "payments_clinicId_completedAt_idx" ON "payments"("clinicId", "completedAt");

-- AddForeignKey
ALTER TABLE "clinic_payment_settings" ADD CONSTRAINT "clinic_payment_settings_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_takenByStaffId_fkey" FOREIGN KEY ("takenByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_voidedByStaffId_fkey" FOREIGN KEY ("voidedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

