import { idSchema, saveMealRequestSchema } from '@macrofill/domain';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client';
import type { AuthEnv } from '../http/auth';
import { invalidRequest, jsonBody, params } from '../http/validation';
import { createRepositories } from '../repositories';
import { saveMeal } from '../services/meals';

export function mealRoutes(db: Db) {
  return new Hono<AuthEnv>()
    .post('/meals', jsonBody(saveMealRequestSchema), async (c) => {
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
    })
    .get('/meals/:id/recording', params(z.object({ id: idSchema })), async (c) => {
      // M4-7: the meal's scale recording, as a JSON file. 404 for a meal without one, as for a meal
      // that isn't the user's (M4-3).
      const { id } = c.req.valid('param');
      const recording = await createRepositories(db, c.get('userId')).scaleRecordings.find(id);
      if (recording === undefined) return c.json({ error: 'not_found' as const }, 404);
      c.header('Content-Disposition', `attachment; filename="recording-${id}.json"`);
      return c.json(recording);
    });
}
