ALTER TABLE "BankTransaction"
ADD COLUMN "reversalReason" TEXT,
ADD COLUMN "reversedById" UUID;

ALTER TABLE "BankTransaction"
ADD CONSTRAINT "BankTransaction_reversedById_fkey"
FOREIGN KEY ("reversedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "BankTransaction_organizationId_reversedAt_idx"
ON "BankTransaction"("organizationId", "reversedAt");

CREATE INDEX "BankTransaction_reversedById_idx"
ON "BankTransaction"("reversedById");
