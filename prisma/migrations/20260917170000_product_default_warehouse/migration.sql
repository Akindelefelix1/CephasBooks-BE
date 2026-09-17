ALTER TABLE "Product" ADD COLUMN "defaultWarehouseId" UUID;

CREATE INDEX "Product_defaultWarehouseId_idx" ON "Product"("defaultWarehouseId");

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_defaultWarehouseId_fkey"
  FOREIGN KEY ("defaultWarehouseId") REFERENCES "Warehouse"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
