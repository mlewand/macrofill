import { describe, expect, it } from 'vitest';
import { barcodeSchema, createProductRequestSchema, parseBarcode } from '../src/index.js';

describe('#65-1, #65-2: barcodes', () => {
  it.each([
    // EAN-13 as is.
    ['5901234123457', '5901234123457'],
    // UPC-A and EAN-8, left-padded with zeros.
    ['036000291452', '0036000291452'],
    ['96385074', '0000096385074'],
    // A detector may report a UPC-A as an EAN-13 with a leading zero: the same product.
    ['0036000291452', '0036000291452'],
    // Spaces, as typed or read off a package.
    [' 5901234 123457 ', '5901234123457'],
  ])('#65-2: %j is stored as %s', (input, stored) => {
    expect(parseBarcode(input)).toEqual({ ok: true, barcode: stored });
  });

  it('#65-1: rejects a wrong check digit', () => {
    expect(parseBarcode('5901234123458')).toEqual({ ok: false, reason: 'checkDigit' });
    expect(parseBarcode('036000291453')).toEqual({ ok: false, reason: 'checkDigit' });
    expect(parseBarcode('96385075')).toEqual({ ok: false, reason: 'checkDigit' });
  });

  it.each([
    '',
    '123',
    '1234567',
    '123456789',
    '12345678901',
    '59012341234570',
    '590123412345a',
    '5901-2341-2345',
  ])('#65-1: rejects %j as not an EAN-13, EAN-8 or UPC-A', (input) => {
    expect(parseBarcode(input)).toEqual({ ok: false, reason: 'format' });
  });

  it('the store form is 13 digits with a valid check digit', () => {
    expect(barcodeSchema.safeParse('5901234123457').success).toBe(true);
    expect(barcodeSchema.safeParse('0036000291452').success).toBe(true);
    expect(barcodeSchema.safeParse('036000291452').success).toBe(false);
    expect(barcodeSchema.safeParse('5901234123458').success).toBe(false);
  });

  it('#65-4: a new product may carry its barcode, in the store form only', () => {
    const request = {
      id: '4f0c7a3e-3b8e-4d7a-9a51-6c1f2d9e8b01',
      ingredientClassId: 'curd',
      name: 'x',
      nutrition: {
        kcal: null,
        fat: null,
        saturates: null,
        carbs: null,
        sugars: null,
        protein: null,
        salt: null,
        fibre: null,
      },
    };
    expect(createProductRequestSchema.parse({ ...request, barcode: '5901234123457' }).barcode).toBe(
      '5901234123457',
    );
    expect(
      createProductRequestSchema.safeParse({ ...request, barcode: '036000291452' }).success,
    ).toBe(false);
    expect(createProductRequestSchema.parse(request).barcode).toBeUndefined();
  });
});
