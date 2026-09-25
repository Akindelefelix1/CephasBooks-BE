import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BillStatus,
  ExpenseStatus,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
} from '@prisma/client';
export class PurchaseLineDto {
  @IsString() @MaxLength(500) description!: string;
  @Type(() => Number) @IsNumber() @Min(0.0001) quantity!: number;
  @Type(() => Number) @IsNumber() @Min(0) unitPrice!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) taxRate = 0;
}
export class SupplierDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsString() displayName!: string;
  @IsOptional() @IsString() companyName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() bankDetails?: string;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() notes?: string;
}
export class RequestDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsString() number!: string;
  @IsString() requestedBy!: string;
  @IsDateString() requiredDate!: string;
  @IsOptional() @IsString() currency = 'NGN';
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  items!: PurchaseLineDto[];
  @IsOptional() @IsString() notes?: string;
}
export class OrderDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsUUID() supplierId!: string;
  @IsOptional() @IsUUID() requestId?: string;
  @IsString() number!: string;
  @IsDateString() orderDate!: string;
  @IsDateString() deliveryDate!: string;
  @IsOptional() @IsString() currency = 'NGN';
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  items!: PurchaseLineDto[];
  @IsOptional() @IsString() notes?: string;
}
export class BillDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsUUID() supplierId!: string;
  @IsOptional() @IsUUID() purchaseOrderId?: string;
  @IsString() number!: string;
  @IsDateString() issueDate!: string;
  @IsDateString() dueDate!: string;
  @IsOptional() @IsString() currency = 'NGN';
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  items!: PurchaseLineDto[];
  @IsOptional() @IsString() notes?: string;
}
export class SupplierPaymentDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsUUID() billId!: string;
  @IsOptional() @IsUUID() bankAccountId?: string;
  @IsString() reference!: string;
  @IsDateString() paymentDate!: string;
  @Type(() => Number) @IsNumber() @Min(0.01) amount!: number;
  @IsString() method!: string;
  @IsOptional() @IsString() notes?: string;
}
export class ExpenseDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() bankAccountId?: string;
  @IsString() reference!: string;
  @IsDateString() expenseDate!: string;
  @IsString() merchant!: string;
  @IsString() category!: string;
  @Type(() => Number) @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) taxAmount = 0;
  @IsOptional() @IsString() currency = 'NGN';
  @IsOptional() @IsString() notes?: string;
}
export class RequestStatusDto {
  @IsEnum(PurchaseRequestStatus) status!: PurchaseRequestStatus;
}
export class OrderStatusDto {
  @IsEnum(PurchaseOrderStatus) status!: PurchaseOrderStatus;
}
export class BillStatusDto {
  @IsEnum(BillStatus) status!: BillStatus;
}
export class ExpenseStatusDto {
  @IsEnum(ExpenseStatus) status!: ExpenseStatus;
}
export class ConvertOrderDto {
  @IsString() number!: string;
  @IsDateString() issueDate!: string;
  @IsDateString() dueDate!: string;
}
