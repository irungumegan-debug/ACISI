-- SHA claims add-on: per-clinic switch, off for every clinic (existing and new).
-- Additive only. Undo: prisma/rollback/20261126100000_sha_addon_switch.down.sql

-- AlterTable
ALTER TABLE "clinics" ADD COLUMN "shaAddonEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "shaAddonChangedAt" TIMESTAMP(3);
