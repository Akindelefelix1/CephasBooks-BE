CREATE TABLE "PosCreditPayment" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "saleId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "receivedById" UUID,
  "reference" VARCHAR(128) NOT NULL,
  "amount" DECIMAL(19,4) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "method" "PosPaymentMethod" NOT NULL,
  "paymentDate" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PosCreditPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PosCreditPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PosCreditPayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PosSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PosCreditPayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PosCreditPayment_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PosCreditPayment_organizationId_reference_key"
  ON "PosCreditPayment"("organizationId", "reference");
CREATE INDEX "PosCreditPayment_organizationId_customerId_paymentDate_idx"
  ON "PosCreditPayment"("organizationId", "customerId", "paymentDate");
CREATE INDEX "PosCreditPayment_saleId_paymentDate_idx"
  ON "PosCreditPayment"("saleId", "paymentDate");