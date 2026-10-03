import { z } from 'zod';

// Barcodes (#65): EAN-13, EAN-8 and UPC-A, kept in one form, the 13-digit one (#63-2). Pure: the
// camera and the digits typed in both end up here.

export type BarcodeResult =
  { ok: true; barcode: string } | { ok: false; reason: 'format' | 'checkDigit' };

/**
 * The GS1 check digit holds for 13 digits: weights 1 and 3 alternate, 3 on the digit next to the
 * check digit. Leading zeros don't change the sum, so a UPC-A or an EAN-8 padded to 13 digits is
 * valid exactly when it is on its own.
 */
function checkDigitHolds(digits13: string): boolean {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits13[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(digits13[12]);
}

/**
 * #65-1, #65-2: a scanned or typed code as the store's 13-digit form. EAN-13 stays as it is, UPC-A
 * (12 digits) and EAN-8 are left-padded with zeros. Spaces are ignored. Anything else, or a wrong
 * check digit, is refused.
 */
export function parseBarcode(input: string): BarcodeResult {
  const digits = input.replace(/\s+/g, '');
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(digits)) return { ok: false, reason: 'format' };
  const barcode = digits.padStart(13, '0');
  return checkDigitHolds(barcode) ? { ok: true, barcode } : { ok: false, reason: 'checkDigit' };
}

/** The store form: 13 digits, check digit valid. */
export const barcodeSchema = z
  .string()
  .regex(/^\d{13}$/)
  .refine(checkDigitHolds, { message: 'The check digit is wrong.' });
