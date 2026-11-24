ALTER TABLE "Project" RENAME COLUMN "actualCost" TO "openingActualCost";
ALTER TABLE "Expense" ADD COLUMN "projectId" UUID;
ALTER TABLE "Invoice" ADD COLUMN "projectId" UUID;
ALTER TABLE "PaymentReceived" ADD COLUMN "projectId" UUID;

CREATE INDEX "Expense_organizationId_projectId_status_idx" ON "Expense"("organizationId", "projectId", "status");
CREATE INDEX "Invoice_organizationId_projectId_idx" ON "Invoice"("organizationId", "projectId");
CREATE INDEX "PaymentReceived_organizationId_projectId_paymentDate_idx" ON "PaymentReceived"("organizationId", "projectId", "paymentDate");

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentReceived" ADD CONSTRAINT "PaymentReceived_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "PaymentReceived" AS payment
SET "projectId" = invoice."projectId"
FROM "Invoice" AS invoice
WHERE payment."invoiceId" = invoice."id" AND invoice."projectId" IS NOT NULL;
