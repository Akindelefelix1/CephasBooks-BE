CREATE TABLE "Branch" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "manager" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Branch_organizationId_code_key" ON "Branch"("organizationId", "code");
CREATE INDEX "Branch_organizationId_isActive_idx" ON "Branch"("organizationId", "isActive");
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Branch" ("id", "organizationId", "code", "name", "address", "manager", "isActive")
SELECT gen_random_uuid(), "organizationId", "code", "name", "address", "manager", "isActive" FROM "Warehouse";

ALTER TABLE "Warehouse" ADD COLUMN "branchId" UUID;
UPDATE "Warehouse" AS warehouse
SET "branchId" = branch."id"
FROM "Branch" AS branch
WHERE branch."organizationId" = warehouse."organizationId" AND branch."code" = warehouse."code";
CREATE UNIQUE INDEX "Warehouse_branchId_key" ON "Warehouse"("branchId");
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD COLUMN "performedById" UUID;
CREATE INDEX "StockMovement_performedById_idx" ON "StockMovement"("performedById");
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "StockMovement_organizationId_warehouseId_productId_idx" ON "StockMovement"("organizationId", "warehouseId", "productId");
