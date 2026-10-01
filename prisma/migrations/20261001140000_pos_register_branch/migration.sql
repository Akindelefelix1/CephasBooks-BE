ALTER TABLE "PosRegister" ADD COLUMN "branchId" UUID;

CREATE INDEX "PosRegister_organizationId_branchId_isActive_idx"
  ON "PosRegister"("organizationId", "branchId", "isActive");
