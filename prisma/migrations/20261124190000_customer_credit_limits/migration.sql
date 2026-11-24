CREATE TABLE "CustomerCreditLimitAdjustment" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "actorId" UUID,
  "previousLimit" DECIMAL(19,4) NOT NULL,
  "newLimit" DECIMAL(19,4) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerCreditLimitAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerCreditLimitAdjustment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerCreditLimitAdjustment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerCreditLimitAdjustment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "CustomerCreditLimitAdjustment_organizationId_customerId_createdAt_idx"
  ON "CustomerCreditLimitAdjustment"("organizationId", "customerId", "createdAt");

CREATE TABLE "CustomerCreditOverrideApproval" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "approverId" UUID,
  "targetType" VARCHAR(24) NOT NULL,
  "targetId" VARCHAR(64) NOT NULL,
  "creditLimit" DECIMAL(19,4) NOT NULL,
  "existingExposure" DECIMAL(19,4) NOT NULL,
  "requestedAmount" DECIMAL(19,4) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerCreditOverrideApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerCreditOverrideApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerCreditOverrideApproval_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerCreditOverrideApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CustomerCreditOverrideApproval_organizationId_targetType_targetId_key"
  ON "CustomerCreditOverrideApproval"("organizationId", "targetType", "targetId");
CREATE INDEX "CustomerCreditOverrideApproval_organizationId_customerId_createdAt_idx"
  ON "CustomerCreditOverrideApproval"("organizationId", "customerId", "createdAt");

ALTER TABLE "PosReturn"
  ADD COLUMN "creditAmount" DECIMAL(19,4) NOT NULL DEFAULT 0;

INSERT INTO "CustomerCreditLimitAdjustment" (
  "id", "organizationId", "customerId", "previousLimit", "newLimit", "reason"
)
SELECT
  gen_random_uuid(), c."organizationId", c."id", 0, c."creditLimit",
  'Existing approved credit limit recorded when credit limit history was introduced.'
FROM "Customer" c
WHERE c."creditLimit" > 0;
