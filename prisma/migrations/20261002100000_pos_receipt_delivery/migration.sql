ALTER TABLE "PosSale" ADD COLUMN "receiptToken" UUID;
UPDATE "PosSale" SET "receiptToken" = gen_random_uuid() WHERE "receiptToken" IS NULL;
ALTER TABLE "PosSale" ALTER COLUMN "receiptToken" SET NOT NULL;
ALTER TABLE "PosSale" ALTER COLUMN "receiptToken" SET DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "PosSale_receiptToken_key" ON "PosSale"("receiptToken");
