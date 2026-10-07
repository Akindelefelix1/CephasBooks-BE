ALTER TABLE "PosRegister"
  ADD COLUMN "terminalId" TEXT,
  ADD COLUMN "defaultCashAccountId" UUID,
  ADD COLUMN "defaultCardAccountId" UUID,
  ADD COLUMN "defaultBankAccountId" UUID;

ALTER TABLE "PosRegister"
  ADD CONSTRAINT "PosRegister_defaultCashAccountId_fkey"
    FOREIGN KEY ("defaultCashAccountId") REFERENCES "BankAccount"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PosRegister_defaultCardAccountId_fkey"
    FOREIGN KEY ("defaultCardAccountId") REFERENCES "BankAccount"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PosRegister_defaultBankAccountId_fkey"
    FOREIGN KEY ("defaultBankAccountId") REFERENCES "BankAccount"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PosShift"
  ADD CONSTRAINT "PosShift_cashierId_fkey"
    FOREIGN KEY ("cashierId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
