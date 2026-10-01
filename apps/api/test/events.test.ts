import { MAX_EVENT_BATCH, type UsageEvent } from '@macrofill/domain';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { queryRows, type Database } from '../src/db/client';
import { seedData } from '../src/seed/data';
import { seed } from '../src/seed/seed';
import { createMigratedTestDatabase } from './support/db';
import { signedIn, type TestApp } from './support/session';

const owner = seedData.users[0]!.user;

const event = (id: string, overrides: Partial<UsageEvent> = {}): UsageEvent =>
  ({
    id,
    clientSessionId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    occurredAt: '2026-01-15T07:00:00.000Z',
    appVersion: 'abc1234',
    name: 'step_completed',
    props: { inputMethod: 'scale', step: 0, durationMs: 8000, weightSource: 'scale' },
    ...overrides,
  }) as UsageEvent;

describe('POST /api/events (M4-10)', () => {
  let database: Database;
  let app: TestApp;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
    await seed(database.db);
    app = await signedIn(createApp({ db: database.db }), database.db);
  });

  afterEach(async () => {
    await database.close();
  });

  const post = (body: unknown) =>
    app.request('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const rows = () =>
    queryRows<{
      id: string;
      owner_id: string;
      client_session_id: string;
      name: string;
      props: unknown;
      occurred_at: Date | string;
      app_version: string;
    }>(database.db, sql`select * from usage_events order by id`);

  it('M4-10: stores a batch of catalog events with the owner', async () => {
    const res = await post({
      events: [
        event('f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a51'),
        event('f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a52', { name: 'scale_disconnected', props: {} }),
      ],
    });
    expect(res.status).toBe(204);
    const stored = await rows();
    expect(stored.map((r) => [r.name, r.owner_id, r.app_version])).toEqual([
      ['step_completed', owner.id, 'abc1234'],
      ['scale_disconnected', owner.id, 'abc1234'],
    ]);
    expect(stored[0]!.props).toEqual({
      inputMethod: 'scale',
      step: 0,
      durationMs: 8000,
      weightSource: 'scale',
    });
    expect(new Date(stored[0]!.occurred_at).toISOString()).toBe('2026-01-15T07:00:00.000Z');
  });

  it('M4-10: a retried batch stores each event once', async () => {
    const batch = { events: [event('f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a51')] };
    expect((await post(batch)).status).toBe(204);
    expect((await post(batch)).status).toBe(204);
    expect(await rows()).toHaveLength(1);
  });

  it('M4-10, M4-4: events outside the catalog are rejected with field-level errors', async () => {
    const res = await post({
      events: [event('f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a51', { name: 'page_viewed' } as never)],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: { path: string }[] };
    expect(body.error).toBe('invalid_request');
    expect(body.issues.length).toBeGreaterThan(0);
    expect(body.issues.every((i) => i.path.startsWith('events.0'))).toBe(true);
    expect(await rows()).toEqual([]);
  });

  it('M4-10: a batch is 1 to 100 events', async () => {
    expect((await post({ events: [] })).status).toBe(400);
    const ids = Array.from(
      { length: MAX_EVENT_BATCH + 1 },
      (_, i) => `f1e2d3c4-b5a6-4978-8a9b-${String(i).padStart(12, '0')}`,
    );
    expect((await post({ events: ids.map((id) => event(id)) })).status).toBe(400);
    expect((await post({ events: ids.slice(1).map((id) => event(id)) })).status).toBe(204);
    expect(await rows()).toHaveLength(MAX_EVENT_BATCH);
  });
});
