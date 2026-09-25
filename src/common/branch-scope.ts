import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type OrganizationReader = {
  organization: {
    findUnique(args: object): Promise<{ onboardingData: Prisma.JsonValue } | null>;
  };
};

export async function assertBranch(
  db: OrganizationReader,
  organizationId: string,
  branchId?: string,
): Promise<void> {
  if (!branchId) return;
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { onboardingData: true },
  });
  const root = asObject(organization?.onboardingData);
  const admin = asObject(root.admin);
  const hierarchy = asObject(admin.branches);
  const branches = Array.isArray(hierarchy.items)
    ? (hierarchy.items as Array<Record<string, unknown>>)
    : [];
  if (!branches.some((branch) => branch.id === branchId && branch.status !== 'Inactive'))
    throw new BadRequestException('Branch is unavailable or does not belong to this organisation');
}

function asObject(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
