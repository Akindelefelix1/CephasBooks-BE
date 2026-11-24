CREATE TABLE "GoodsReceivedNote" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "recordedById" UUID,
    "reference" TEXT NOT NULL,
    "supplierReference" TEXT,
    "receivedDate" DATE NOT NULL,
    "items" JSONB NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoodsReceivedNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoodsReceivedNote_organizationId_reference_key"
ON "GoodsReceivedNote"("organizationId", "reference");
CREATE INDEX "GoodsReceivedNote_organizationId_receivedDate_idx"
ON "GoodsReceivedNote"("organizationId", "receivedDate");
CREATE INDEX "GoodsReceivedNote_organizationId_purchaseOrderId_idx"
ON "GoodsReceivedNote"("organizationId", "purchaseOrderId");
CREATE INDEX "GoodsReceivedNote_organizationId_supplierId_idx"
ON "GoodsReceivedNote"("organizationId", "supplierId");

ALTER TABLE "GoodsReceivedNote" ADD CONSTRAINT "GoodsReceivedNote_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoodsReceivedNote" ADD CONSTRAINT "GoodsReceivedNote_purchaseOrderId_fkey"
FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoodsReceivedNote" ADD CONSTRAINT "GoodsReceivedNote_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoodsReceivedNote" ADD CONSTRAINT "GoodsReceivedNote_warehouseId_fkey"
FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoodsReceivedNote" ADD CONSTRAINT "GoodsReceivedNote_recordedById_fkey"
FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
