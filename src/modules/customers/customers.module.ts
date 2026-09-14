import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.ts';
import { CustomersService } from './customers.service.ts';
@Module({ controllers: [CustomersController], providers: [CustomersService] })
export class CustomersModule {}
