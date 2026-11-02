-- Patient signup: verify the phone FIRST, then choose the PIN.
-- A pending signup no longer carries a PIN when it is created; it gets one
-- only after the phone is verified. Additive: existing rows are unchanged.

-- AlterTable
ALTER TABLE "pending_patient_signups" ALTER COLUMN "pinHash" DROP NOT NULL;
ALTER TABLE "pending_patient_signups" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);
ALTER TABLE "pending_patient_signups" ADD COLUMN "pinSetupTokenHash" TEXT;
ALTER TABLE "pending_patient_signups" ADD COLUMN "pinSetupExpiresAt" TIMESTAMP(3);
