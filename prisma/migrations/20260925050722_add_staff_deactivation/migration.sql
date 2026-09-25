-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedByStaffId" TEXT;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_deactivatedByStaffId_fkey" FOREIGN KEY ("deactivatedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

