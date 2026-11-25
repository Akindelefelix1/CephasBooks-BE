ALTER TABLE "Customer"
  ADD COLUMN "paymentTermsDays" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "Supplier"
  ADD COLUMN "paymentTermsDays" INTEGER NOT NULL DEFAULT 30;

UPDATE "Supplier"
SET "paymentTermsDays" = CASE
  WHEN lower(trim("paymentTerms")) IN ('due on receipt', 'due immediately', 'immediate') THEN 0
  WHEN substring("paymentTerms" from '([0-9]+)') IS NOT NULL THEN
    LEAST(3650, GREATEST(0, substring("paymentTerms" from '([0-9]+)')::INTEGER))
  ELSE 30
END
WHERE "paymentTerms" IS NOT NULL;
