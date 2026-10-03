import { createProductRequestSchema } from '@macrofill/domain';
import { Hono } from 'hono';
import type { Db } from '../db/client';
import type { AuthEnv } from '../http/auth';
import { invalidRequest, jsonBody } from '../http/validation';
import { createProduct } from '../services/products';

export function productRoutes(db: Db) {
  return new Hono<AuthEnv>().post('/products', jsonBody(createProductRequestSchema), async (c) => {
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
    }
  });
}
