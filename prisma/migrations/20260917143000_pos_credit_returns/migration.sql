ALTER TABLE "Customer" ADD COLUMN "creditLimit" DECIMAL(19,4) NOT NULL DEFAULT 0;
ALTER TABLE "PosSale" ADD COLUMN "discountApprovedBy" UUID;
CREATE TABLE "PosReturn" ("id" UUID NOT NULL, "organizationId" UUID NOT NULL, "saleId" UUID NOT NULL, "productId" UUID NOT NULL, "quantity" DECIMAL(19,4) NOT NULL, "amount" DECIMAL(19,4) NOT NULL, "reason" TEXT NOT NULL, "processedBy" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PosReturn_pkey" PRIMARY KEY ("id"));
CREATE INDEX "PosReturn_organizationId_saleId_idx" ON "PosReturn"("organizationId", "saleId");
ALTER TABLE "PosReturn" ADD CONSTRAINT "PosReturn_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosReturn" ADD CONSTRAINT "PosReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PosSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosReturn" ADD CONSTRAINT "PosReturn_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
