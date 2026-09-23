-- AlterTable
ALTER TABLE "encounters" ADD COLUMN     "assignedDoctorId" TEXT;

-- CreateIndex
CREATE INDEX "encounters_assignedDoctorId_idx" ON "encounters"("assignedDoctorId");

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_assignedDoctorId_fkey" FOREIGN KEY ("assignedDoctorId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
