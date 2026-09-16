import {
  ApprovalStatus,
  DocumentStatus,
  NotificationCategory,
  Role,
  WorkflowStatus,
} from '@prisma/client';
import {
  IsBase64,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class DocumentDto {
  @IsString() @IsNotEmpty() @MaxLength(180) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(60) category!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) mimeType!: string;
  @IsBase64() contentBase64!: string;
  @IsOptional()
  @IsString()
  @IsIn(['INVOICE', 'BILL', 'EXPENSE', 'PURCHASE_ORDER', 'PROJECT'])
  linkedType?: string;
  @IsOptional() @IsString() @MaxLength(120) linkedReference?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
export class DocumentStatusDto {
  @IsEnum(DocumentStatus) status!: DocumentStatus;
}
export class ApprovalDto {
  @IsString() @IsNotEmpty() @MaxLength(140) title!: string;
  @IsString()
  @IsIn(['INVOICE', 'BILL', 'EXPENSE', 'PURCHASE_ORDER', 'PROJECT', 'MANUAL'])
  entityType!: string;
  @IsOptional() @IsString() entityId?: string;
  @IsString() @IsNotEmpty() @MaxLength(100) reference!: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsEnum(Role) assignedRole!: Role;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
export class ApprovalDecisionDto {
  @IsEnum(ApprovalStatus)
  @IsIn([ApprovalStatus.APPROVED, ApprovalStatus.REJECTED, ApprovalStatus.CANCELLED])
  status!: ApprovalStatus;
  @IsOptional() @IsString() @MaxLength(500) decisionNote?: string;
}
export class NotificationDto {
  @IsString() @IsNotEmpty() @MaxLength(120) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) message!: string;
  @IsEnum(NotificationCategory) category!: NotificationCategory;
  @IsOptional() @IsString() relatedType?: string;
  @IsOptional() @IsString() relatedId?: string;
}
export class ReadDto {
  @IsOptional() @IsBoolean() isRead?: boolean;
}
export class WorkflowDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @IsString()
  @IsIn([
    'INVOICE_CREATED',
    'BILL_CREATED',
    'EXPENSE_CREATED',
    'APPROVAL_DECIDED',
    'STOCK_LOW',
    'MANUAL',
  ])
  event!: string;
  @IsString() @IsNotEmpty() @MaxLength(300) condition!: string;
  @IsString() @IsIn(['CREATE_APPROVAL', 'SEND_NOTIFICATION', 'FLAG_FOR_REVIEW']) action!: string;
}
export class WorkflowStatusDto {
  @IsEnum(WorkflowStatus) status!: WorkflowStatus;
}
