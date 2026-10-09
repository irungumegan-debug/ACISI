-- AlterEnum
ALTER TYPE "CheckInStatus" ADD VALUE 'NEEDS_REVIEW';

-- AlterTable
ALTER TABLE "check_ins" ADD COLUMN     "manualMpesaCode" TEXT,
ADD COLUMN     "paymentConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "paymentConfirmedByStaffId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "check_ins_manualMpesaCode_key" ON "check_ins"("manualMpesaCode");

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_paymentConfirmedByStaffId_fkey" FOREIGN KEY ("paymentConfirmedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

