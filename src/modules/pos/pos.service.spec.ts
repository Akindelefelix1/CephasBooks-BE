import { BadRequestException } from '@nestjs/common';
import { assertSaleQuantity } from './pos.service.ts';

describe('POS sale quantities', () => {
  it('allows whole quantities for every product', () => {
    expect(() =>
      assertSaleQuantity({ name: 'Rice', allowFractionalSale: false }, 5),
    ).not.toThrow();
  });

  it('rejects fractional quantities for whole-unit products', () => {
    expect(() =>
      assertSaleQuantity({ name: 'Milk', allowFractionalSale: false }, 5.5),
    ).toThrow(BadRequestException);
  });

  it('allows half-unit quantities when enabled', () => {
    expect(() =>
      assertSaleQuantity({ name: 'Fabric', allowFractionalSale: true }, 5.5),
    ).not.toThrow();
  });

  it('rejects quantities smaller than half-unit increments', () => {
    expect(() =>
      assertSaleQuantity({ name: 'Fabric', allowFractionalSale: true }, 5.25),
    ).toThrow(BadRequestException);
  });
});
