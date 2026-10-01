import { usageEventBatchSchema } from '@macrofill/domain';
import { Hono } from 'hono';
import type { Db } from '../db/client';
import type { AuthEnv } from '../http/auth';
import { jsonBody } from '../http/validation';
import { createRepositories } from '../repositories';

class NotFound extends Error {}

/**
 * M4-10: a batch of usage events (M7-8), stored as the user's. An id that's another user's makes
 * the batch not found (M4-3), and nothing of it is stored.
 */
export function eventRoutes(db: Db) {
  return new Hono<AuthEnv>().post('/events', jsonBody(usageEventBatchSchema), async (c) => {
    const { events } = c.req.valid('json');
    try {
      await db.transaction(async (tx) => {
        if (!(await createRepositories(tx, c.get('userId')).usageEvents.insert(events))) {
          throw new NotFound();
        }
      });
    } catch (error) {
      if (error instanceof NotFound) return c.json({ error: 'not_found' as const }, 404);
      throw error;
    }
    return c.body(null, 204);
  });
}
