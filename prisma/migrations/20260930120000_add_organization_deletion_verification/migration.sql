ALTER TABLE "Organization"
ADD COLUMN "deletionCodeHash" TEXT,
ADD COLUMN "deletionCodeExpiresAt" TIMESTAMP(3),
ADD COLUMN "deletionCodeSentAt" TIMESTAMP(3),
ADD COLUMN "deletionCodeAttempts" INTEGER NOT NULL DEFAULT 0;
