ALTER TABLE "User"
ADD COLUMN "verificationCodeHash" TEXT,
ADD COLUMN "verificationCodeExpiresAt" TIMESTAMP(3),
ADD COLUMN "verificationCodeSentAt" TIMESTAMP(3);
