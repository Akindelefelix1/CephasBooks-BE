import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateCommerceChannelDto {
  @IsString() @MaxLength(120) name!: string;
  @IsIn(['POS', 'B2B', 'ONLINE_STORE', 'MARKETPLACE', 'SOCIAL', 'CUSTOM_API']) type!: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsBoolean() syncInventory?: boolean;
  @IsOptional() @IsBoolean() syncOrders?: boolean;
  @IsOptional() @IsBoolean() syncCustomers?: boolean;
}

export class UpdateCommerceChannelDto extends CreateCommerceChannelDto {
  @IsOptional() @IsIn(['ACTIVE', 'PAUSED']) status?: string;
}
