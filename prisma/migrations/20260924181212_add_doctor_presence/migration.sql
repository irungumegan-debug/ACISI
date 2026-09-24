-- CreateEnum
CREATE TYPE "StaffPresenceOverride" AS ENUM ('IN', 'OUT');

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "presenceOverride" "StaffPresenceOverride",
ADD COLUMN     "presenceOverrideAt" TIMESTAMP(3);
