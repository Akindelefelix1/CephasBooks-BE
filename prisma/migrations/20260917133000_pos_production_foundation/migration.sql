CREATE TYPE "PosSaleStatus" AS ENUM ('HELD', 'COMPLETED', 'VOIDED', 'REFUNDED');
CREATE TYPE "PosPaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'CREDIT');
CREATE TYPE "PosPaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'REVERSED');
CREATE TYPE "PosShiftStatus" AS ENUM ('OPEN', 'CLOSED');

ALTER TABLE "PosSale" ADD COLUMN "registerId" UUID, ADD COLUMN "shiftId" UUID, ADD COLUMN "warehouseId" UUID, ADD COLUMN "cashierId" UUID, ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "PosSale" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PosSale" ALTER COLUMN "status" TYPE "PosSaleStatus" USING "status"::"PosSaleStatus";
ALTER TABLE "PosSale" ALTER COLUMN "status" SET DEFAULT 'COMPLETED';
ALTER TABLE "PosPayment" ADD COLUMN "status" "PosPaymentStatus" NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "PosPayment" ALTER COLUMN "method" TYPE "PosPaymentMethod" USING "method"::"PosPaymentMethod";

CREATE TABLE "PosRegister" ("id" UUID NOT NULL, "organizationId" UUID NOT NULL, "warehouseId" UUID NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PosRegister_pkey" PRIMARY KEY ("id"));
CREATE TABLE "PosShift" ("id" UUID NOT NULL, "organizationId" UUID NOT NULL, "registerId" UUID NOT NULL, "cashierId" UUID NOT NULL, "status" "PosShiftStatus" NOT NULL DEFAULT 'OPEN', "openingCash" DECIMAL(19,4) NOT NULL, "closingCash" DECIMAL(19,4), "expectedCash" DECIMAL(19,4), "variance" DECIMAL(19,4), "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "closedAt" TIMESTAMP(3), "closeNotes" TEXT, CONSTRAINT "PosShift_pkey" PRIMARY KEY ("id"));
CREATE TABLE "PosIdempotencyKey" ("id" UUID NOT NULL, "organizationId" UUID NOT NULL, "key" TEXT NOT NULL, "saleId" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PosIdempotencyKey_pkey" PRIMARY KEY ("id"));
CREATE TABLE "PosAuditLog" ("id" UUID NOT NULL, "organizationId" UUID NOT NULL, "actorId" UUID, "action" TEXT NOT NULL, "entityType" TEXT NOT NULL, "entityId" TEXT, "metadata" JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PosAuditLog_pkey" PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "PosSale_organizationId_idempotencyKey_key" ON "PosSale"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "PosRegister_organizationId_code_key" ON "PosRegister"("organizationId", "code");
CREATE INDEX "PosRegister_organizationId_warehouseId_isActive_idx" ON "PosRegister"("organizationId", "warehouseId", "isActive");
CREATE INDEX "PosShift_organizationId_cashierId_status_idx" ON "PosShift"("organizationId", "cashierId", "status");
CREATE INDEX "PosShift_registerId_status_idx" ON "PosShift"("registerId", "status");
CREATE UNIQUE INDEX "PosIdempotencyKey_organizationId_key_key" ON "PosIdempotencyKey"("organizationId", "key");
CREATE INDEX "PosAuditLog_organizationId_createdAt_idx" ON "PosAuditLog"("organizationId", "createdAt");
ALTER TABLE "PosRegister" ADD CONSTRAINT "PosRegister_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosRegister" ADD CONSTRAINT "PosRegister_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "PosRegister"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosIdempotencyKey" ADD CONSTRAINT "PosIdempotencyKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosAuditLog" ADD CONSTRAINT "PosAuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "PosRegister"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
