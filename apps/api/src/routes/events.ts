import { usageEventBatchSchema } from '@macrofill/domain';
import { Hono } from 'hono';
import type { Db } from '../db/client';
import type { AuthEnv } from '../http/auth';
import { jsonBody } from '../http/validation';
import { createRepositories } from '../repositories';

/** M4-10: a batch of usage events (M7-8), stored as the user's. */
export function eventRoutes(db: Db) {
  return new Hono<AuthEnv>().post('/events', jsonBody(usageEventBatchSchema), async (c) => {
    await createRepositories(db, c.get('userId')).usageEvents.insert(c.req.valid('json').events);
    return c.body(null, 204);
  });
}
