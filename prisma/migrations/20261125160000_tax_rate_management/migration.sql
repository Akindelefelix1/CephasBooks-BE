CREATE TABLE "TaxRate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "rate" DECIMAL(7,4) NOT NULL,
    "description" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaxRate_organizationId_name_key" ON "TaxRate"("organizationId", "name");
CREATE INDEX "TaxRate_organizationId_isActive_name_idx" ON "TaxRate"("organizationId", "isActive", "name");
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TaxRateRevision" (
    "id" UUID NOT NULL,
    "taxRateId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "rate" DECIMAL(7,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaxRateRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaxRateRevision_taxRateId_version_key" ON "TaxRateRevision"("taxRateId", "version");
CREATE INDEX "TaxRateRevision_taxRateId_createdAt_idx" ON "TaxRateRevision"("taxRateId", "createdAt");
ALTER TABLE "TaxRateRevision" ADD CONSTRAINT "TaxRateRevision_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Product" ADD COLUMN "taxRateId" UUID;
CREATE INDEX "Product_taxRateId_idx" ON "Product"("taxRateId");
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InvoiceItem" ADD COLUMN "taxRateId" UUID;
ALTER TABLE "InvoiceItem" ADD COLUMN "taxRateVersion" INTEGER;
ALTER TABLE "InvoiceItem" ADD COLUMN "taxName" VARCHAR(100) NOT NULL DEFAULT 'Tax';
ALTER TABLE "InvoiceItem" ADD COLUMN "taxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0;
UPDATE "InvoiceItem" SET "taxAmount" = GREATEST(ROUND("lineTotal" - ("quantity" * "unitPrice"), 4), 0);
CREATE INDEX "InvoiceItem_taxRateId_idx" ON "InvoiceItem"("taxRateId");
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PosSaleItem" ADD COLUMN "taxRateId" UUID;
ALTER TABLE "PosSaleItem" ADD COLUMN "taxRateVersion" INTEGER;
ALTER TABLE "PosSaleItem" ADD COLUMN "taxName" VARCHAR(100) NOT NULL DEFAULT 'Tax';
ALTER TABLE "PosSaleItem" ADD COLUMN "taxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0;
UPDATE "PosSaleItem" SET "taxAmount" = GREATEST(ROUND("lineTotal" - (("quantity" * "unitPrice") - "discount"), 4), 0);
CREATE INDEX "PosSaleItem_taxRateId_idx" ON "PosSaleItem"("taxRateId");
ALTER TABLE "PosSaleItem" ADD CONSTRAINT "PosSaleItem_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "TaxRate" ("id", "organizationId", "name", "rate", "description", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), p."organizationId", 'Tax ' || trim_scale(p."taxRate")::text || '%', p."taxRate", 'Migrated from the existing product tax rate.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Product" p
WHERE p."taxRate" > 0 AND p."taxRate" <= 100
GROUP BY p."organizationId", p."taxRate"
ON CONFLICT ("organizationId", "name") DO NOTHING;

UPDATE "Product" p
SET "taxRateId" = t."id"
FROM "TaxRate" t
WHERE t."organizationId" = p."organizationId"
  AND t."rate" = p."taxRate"
  AND t."name" = 'Tax ' || trim_scale(p."taxRate")::text || '%'
  AND p."taxRateId" IS NULL;
