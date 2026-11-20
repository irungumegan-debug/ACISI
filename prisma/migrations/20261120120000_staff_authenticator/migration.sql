-- Authenticator-app multi-factor login for staff. Additive only: two nullable columns.
-- Undo: prisma/rollback/20261120120000_staff_authenticator.down.sql

-- AlterTable
ALTER TABLE "staff" ADD COLUMN "totpSecret" TEXT,
ADD COLUMN "totpEnabledAt" TIMESTAMP(3);
