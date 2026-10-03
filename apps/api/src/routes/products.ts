import { createProductRequestSchema, parseBarcode } from '@macrofill/domain';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client';
import type { AuthEnv } from '../http/auth';
import { invalidRequest, jsonBody, params } from '../http/validation';
import { createRepositories } from '../repositories';
import { createProduct, shown } from '../services/products';

export function productRoutes(db: Db) {
  return new Hono<AuthEnv>()
    .post('/products', jsonBody(createProductRequestSchema), async (c) => {
      const result = await createProduct(db, c.get('userId'), c.req.valid('json'));
      switch (result.status) {
        case 'created':
          return c.json(result.product, 201);
        case 'replayed':
          return c.json(result.product, 200);
        case 'invalid':
          return invalidRequest(c, result.issues);
        case 'conflict':
          return c.json({ error: 'conflict' as const }, 409);
        case 'barcode_taken':
          return c.json({ error: 'barcode_taken' as const }, 409);
      }
    })
    .get('/products/by-barcode/:code', params(z.object({ code: z.string() })), async (c) => {
      // #65-3: the code as scanned or typed (UPC-A and EAN-8 included); the store has one form.
      const parsed = parseBarcode(c.req.valid('param').code);
      if (!parsed.ok) {
        const message =
          parsed.reason === 'checkDigit'
            ? 'The check digit is wrong.'
            : 'Not an EAN-13, EAN-8 or UPC-A code.';
        return invalidRequest(c, [{ path: 'code', message }]);
      }
      const product = await createRepositories(db, c.get('userId')).products.findByBarcode(
        parsed.barcode,
      );
      if (product === undefined) return c.json({ error: 'not_found' as const }, 404);
      return c.json(shown(product), 200);
    });
}
