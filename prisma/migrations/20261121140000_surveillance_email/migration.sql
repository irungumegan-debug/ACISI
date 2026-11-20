-- Sub-County surveillance coordinator email per clinic, for emailed MOH 505 summaries and immediate notices.
-- Additive only: two nullable columns. Undo: prisma/rollback/20261121140000_surveillance_email.down.sql

-- AlterTable
ALTER TABLE "clinics" ADD COLUMN     "surveillanceEmail" TEXT,
ADD COLUMN     "surveillanceWeeklySentFor" TEXT;

