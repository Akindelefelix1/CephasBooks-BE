ALTER TABLE "Warehouse" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Warehouse_one_default_per_organization_idx"
  ON "Warehouse"("organizationId") WHERE "isDefault" = true;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", "id") AS row_number
  FROM "Warehouse"
  WHERE "isActive" = true
)
UPDATE "Warehouse"
SET "isDefault" = true
FROM ranked
WHERE "Warehouse"."id" = ranked."id" AND ranked.row_number = 1;
