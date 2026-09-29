import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { Db } from '../db/client';
import { users } from '../db/schema';

export interface AuthEnv {
  Variables: { userId: string };
}

/**
 * Phase A interim: every request acts as one seeded user (the app is reachable only on the LAN).
 * Phase C replaces only this middleware with session cookies (M4-1, M4-2).
 */
export function stubAuth(db: Db, username: string) {
  let userId: string | undefined;
  return createMiddleware<AuthEnv>(async (c, next) => {
    if (userId === undefined) {
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username));
      if (user === undefined) return c.json({ error: 'unauthorized' }, 401);
      userId = user.id;
    }
    c.set('userId', userId);
    await next();
  });
}
