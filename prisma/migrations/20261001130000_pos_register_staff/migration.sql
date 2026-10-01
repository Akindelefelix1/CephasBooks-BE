ALTER TABLE "PosRegister" ADD COLUMN "assignedStaffId" UUID;

CREATE INDEX "PosRegister_organizationId_assignedStaffId_isActive_idx"
  ON "PosRegister"("organizationId", "assignedStaffId", "isActive");

ALTER TABLE "PosRegister"
  ADD CONSTRAINT "PosRegister_assignedStaffId_fkey"
  FOREIGN KEY ("assignedStaffId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
