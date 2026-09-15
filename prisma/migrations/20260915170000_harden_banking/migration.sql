ALTER TABLE "BankTransaction" ADD COLUMN "importFingerprint" TEXT,
ADD COLUMN "transferGroupId" UUID,
ADD COLUMN "reversedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "BankTransaction_organizationId_bankAccountId_importFingerprint_key" ON "BankTransaction"("organizationId", "bankAccountId", "importFingerprint");
CREATE INDEX "BankTransaction_transferGroupId_idx" ON "BankTransaction"("transferGroupId");
