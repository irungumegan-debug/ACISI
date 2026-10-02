-- CreateTable
CREATE TABLE "staff_otps" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_otps_staffId_idx" ON "staff_otps"("staffId");

-- AddForeignKey
ALTER TABLE "staff_otps" ADD CONSTRAINT "staff_otps_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
