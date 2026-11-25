CREATE TABLE "AssetDepreciationEntry" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "accumulatedDepreciation" DECIMAL(19,4) NOT NULL,
    "carryingAmount" DECIMAL(19,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "journalId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetDepreciationEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetDepreciationEntry_journalId_key" ON "AssetDepreciationEntry"("journalId");
CREATE UNIQUE INDEX "AssetDepreciationEntry_assetId_periodEnd_key" ON "AssetDepreciationEntry"("assetId", "periodEnd");
CREATE INDEX "AssetDepreciationEntry_organizationId_periodEnd_status_idx" ON "AssetDepreciationEntry"("organizationId", "periodEnd", "status");

ALTER TABLE "AssetDepreciationEntry" ADD CONSTRAINT "AssetDepreciationEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssetDepreciationEntry" ADD CONSTRAINT "AssetDepreciationEntry_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FinanceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssetDepreciationEntry" ADD CONSTRAINT "AssetDepreciationEntry_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
