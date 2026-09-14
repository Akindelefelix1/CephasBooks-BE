import { PartialType } from '@nestjs/swagger';
import { CreateCustomerDto } from './create-customer.dto.ts';
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}
