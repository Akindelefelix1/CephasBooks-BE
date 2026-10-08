CREATE TABLE "CommerceChannel" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "branchId" UUID,
    "warehouseId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "syncInventory" BOOLEAN NOT NULL DEFAULT true,
    "syncOrders" BOOLEAN NOT NULL DEFAULT true,
    "syncCustomers" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommerceChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommerceChannel_organizationId_name_key" ON "CommerceChannel"("organizationId", "name");
CREATE INDEX "CommerceChannel_organizationId_status_idx" ON "CommerceChannel"("organizationId", "status");
CREATE INDEX "CommerceChannel_organizationId_warehouseId_idx" ON "CommerceChannel"("organizationId", "warehouseId");

ALTER TABLE "CommerceChannel" ADD CONSTRAINT "CommerceChannel_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceChannel" ADD CONSTRAINT "CommerceChannel_warehouseId_fkey"
FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
