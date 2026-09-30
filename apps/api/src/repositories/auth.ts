import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions, users } from '../db/schema';

/**
 * Data access for logging in and resolving sessions. The one exception to owner-scoped
 * repositories: it runs before there's a current user, and finds that user.
 */
export function createAuthRepository(db: Db) {
  return {
    async userByUsername(
      username: string,
    ): Promise<{ id: string; passwordHash: string | null } | undefined> {
      const [user] = await db
        .select({ id: users.id, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.username, username));
      return user;
    },

    /** Sets the hash of an existing user; returns whether the user exists. */
    async setPasswordHash(username: string, passwordHash: string): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ passwordHash })
        .where(eq(users.username, username))
        .returning({ id: users.id });
      return rows.length > 0;
    },

    /** Sets the hash only where none is set yet; returns whether it did. */
    async setInitialPasswordHash(username: string, passwordHash: string): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ passwordHash })
        .where(and(eq(users.username, username), isNull(users.passwordHash)))
        .returning({ id: users.id });
      return rows.length > 0;
    },

    async createSession(session: typeof sessions.$inferInsert): Promise<void> {
      await db.insert(sessions).values(session);
    },

    /** The owner of an unexpired session, if any. */
    async sessionOwner(id: string, now: Date): Promise<string | undefined> {
      const [row] = await db
        .select({ ownerId: sessions.ownerId })
        .from(sessions)
        .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)));
      return row?.ownerId;
    },
  };
}
