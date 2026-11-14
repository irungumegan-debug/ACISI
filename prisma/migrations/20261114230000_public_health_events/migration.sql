-- Public health events (event-based surveillance). Additive only: one enum and one table.
-- Undo: prisma/rollback/20261114230000_public_health_events.down.sql

-- CreateEnum
CREATE TYPE "PublicHealthEventType" AS ENUM ('ILLNESS_CLUSTER', 'DEATH_CLUSTER', 'ANIMAL_ILLNESS', 'AEFI', 'SARI_CLUSTER', 'MATERNAL_DEATH', 'NEONATAL_DEATH', 'MALARIA_DEATH', 'OTHER_EVENT');

-- CreateTable
CREATE TABLE "public_health_events" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "type" "PublicHealthEventType" NOT NULL,
    "detectedOn" DATE NOT NULL,
    "casesCount" INTEGER NOT NULL DEFAULT 0,
    "casesUnder5" INTEGER NOT NULL DEFAULT 0,
    "deathsCount" INTEGER NOT NULL DEFAULT 0,
    "deathsUnder5" INTEGER NOT NULL DEFAULT 0,
    "eventDescription" TEXT NOT NULL,
    "eventPlace" TEXT,
    "recordedByStaffId" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3),
    "reportedByStaffId" TEXT,
    "reportNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_health_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "public_health_events_clinicId_detectedOn_idx" ON "public_health_events"("clinicId", "detectedOn");

-- AddForeignKey
ALTER TABLE "public_health_events" ADD CONSTRAINT "public_health_events_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_health_events" ADD CONSTRAINT "public_health_events_recordedByStaffId_fkey" FOREIGN KEY ("recordedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_health_events" ADD CONSTRAINT "public_health_events_reportedByStaffId_fkey" FOREIGN KEY ("reportedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
