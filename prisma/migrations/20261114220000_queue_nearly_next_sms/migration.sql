-- "You're nearly next" SMS, sent at most once per visit. Additive only: one column.
-- Undo: prisma/rollback/20261114220000_queue_nearly_next_sms.down.sql

-- AlterTable
ALTER TABLE "encounters" ADD COLUMN     "nearlyNextSmsAt" TIMESTAMP(3);
