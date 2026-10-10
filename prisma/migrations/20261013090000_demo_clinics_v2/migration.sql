-- Demo clinics, back in the app with simulated payments (see
-- src/services/demoClinicService.ts). Re-adds what 20261012090000 removed,
-- plus demoConfig (the seed parameters, so a demo can be reset).

-- AlterTable
ALTER TABLE "clinics" ADD COLUMN     "demoConfig" JSONB,
ADD COLUMN     "demoKey" TEXT,
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "demoClinicId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "clinics_demoKey_key" ON "clinics"("demoKey");

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_demoClinicId_fkey" FOREIGN KEY ("demoClinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

