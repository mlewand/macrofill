import type { Me } from '@macrofill/domain';
import { Hono } from 'hono';
import type { Db } from '../db/client';
import type { AuthEnv } from '../http/auth';
import { createRepositories } from '../repositories';

/** Who the session belongs to: the app binds its saves to them (M4-1). */
export function meRoutes(db: Db) {
  return new Hono<AuthEnv>().get('/me', async (c) =>
    c.json({
      username: await createRepositories(db, c.get('userId')).user.username(),
    } satisfies Me),
  );
}
