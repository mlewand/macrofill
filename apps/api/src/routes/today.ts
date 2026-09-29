import { idSchema } from '@macrofill/domain';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client';
import type { AuthEnv } from '../http/auth';
import { params } from '../http/validation';
import { createRepositories } from '../repositories';
import { getToday } from '../services/today';

export function todayRoutes(db: Db, now: () => Date) {
  return new Hono<AuthEnv>()
    .get('/today', async (c) => c.json(await getToday(db, c.get('userId'), now())))
    .delete('/consumption-entries/:id', params(z.object({ id: idSchema })), async (c) => {
      const repos = createRepositories(db, c.get('userId'));
      const deleted = await repos.consumptionEntries.delete(c.req.valid('param').id);
      return deleted ? c.body(null, 204) : c.json({ error: 'not_found' as const }, 404);
    });
}
