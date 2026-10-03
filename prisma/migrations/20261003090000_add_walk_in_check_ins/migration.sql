-- CreateEnum
CREATE TYPE "CheckInSource" AS ENUM ('REMOTE', 'WALK_IN');

-- AlterEnum
ALTER TYPE "CheckInStatus" ADD VALUE 'NO_FEE';

-- AlterEnum
ALTER TYPE "ConsentType" ADD VALUE 'SMS_CLINIC_MESSAGES';

-- AlterTable
ALTER TABLE "check_ins" ADD COLUMN     "source" "CheckInSource" NOT NULL DEFAULT 'REMOTE';
