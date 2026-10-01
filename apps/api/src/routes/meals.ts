import { saveMealRequestSchema } from '@macrofill/domain';
import { Hono } from 'hono';
import type { Db } from '../db/client';
import type { AuthEnv } from '../http/auth';
import { invalidRequest, jsonBody } from '../http/validation';
import { saveMeal } from '../services/meals';

export function mealRoutes(db: Db) {
  return new Hono<AuthEnv>().post('/meals', jsonBody(saveMealRequestSchema), async (c) => {
    const result = await saveMeal(db, c.get('userId'), c.req.valid('json'));
    switch (result.status) {
      case 'created':
        return c.json(result.body, 201);
      case 'replayed':
        return c.json(result.body, 200);
      case 'invalid':
        return invalidRequest(c, result.issues);
      case 'conflict':
        return c.json({ error: 'conflict' as const }, 409);
      case 'not_found':
        return c.json({ error: 'not_found' as const }, 404);
      case 'wrong_user':
        return c.json({ error: 'wrong_user' as const }, 403);
      case 'deleted':
        return c.json({ error: 'deleted' as const }, 410);
    }
  });
}
