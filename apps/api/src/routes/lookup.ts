import { parseBarcode, type LookupResponse } from '@macrofill/domain';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../http/auth';
import { invalidRequest, params } from '../http/validation';
import type { ProductLookupProvider } from '../lookup/provider';
import { lookupBarcode } from '../services/lookup';

export function lookupRoutes(providers: readonly ProductLookupProvider[]) {
  return new Hono<AuthEnv>().get(
    '/product-lookup/:code',
    params(z.object({ code: z.string() })),
    async (c) => {
      // #66-1: the web app never calls a provider itself. The code as scanned or typed, normalized
      // as for the store's own lookup (#65-2); the answer is always a 200 with what each provider
      // came to, so the user is never left with an error where an empty form will do (#66-4).
      const parsed = parseBarcode(c.req.valid('param').code);
      if (!parsed.ok) {
        const message =
          parsed.reason === 'checkDigit'
            ? 'The check digit is wrong.'
            : 'Not an EAN-13, EAN-8 or UPC-A code.';
        return invalidRequest(c, [{ path: 'code', message }]);
      }
      return c.json((await lookupBarcode(providers, parsed.barcode)) satisfies LookupResponse, 200);
    },
  );
}
