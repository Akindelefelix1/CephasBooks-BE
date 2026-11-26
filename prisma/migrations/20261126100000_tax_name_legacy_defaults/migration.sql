-- Preserve accurate labels for records created before tax names were stored.
UPDATE "InvoiceItem"
SET "taxName" = CASE WHEN "taxRate" > 0 THEN 'Tax' ELSE 'No tax' END
WHERE "taxName" = 'Tax';

UPDATE "PosSaleItem"
SET "taxName" = CASE WHEN "taxRate" > 0 THEN 'Tax' ELSE 'No tax' END
WHERE "taxName" = 'Tax';

ALTER TABLE "InvoiceItem" ALTER COLUMN "taxName" SET DEFAULT 'No tax';
ALTER TABLE "PosSaleItem" ALTER COLUMN "taxName" SET DEFAULT 'No tax';
