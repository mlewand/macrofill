import {
  MAX_RECORDED_FRAMES,
  scaleRecordingSchema,
  type SaveMealRequest,
  type ScaleRecording,
} from '@macrofill/domain';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { queryRows, type Database } from '../src/db/client';
import { seedData } from '../src/seed/data';
import { seed } from '../src/seed/seed';
import { createMigratedTestDatabase } from './support/db';
import { signedIn, type TestApp } from './support/session';

const curdRecipe = seedData.recipes.find((r) => r.name.en === 'Curd')!;
const curd = seedData.products.find((p) => p.ingredientClassId === 'curd')!;
const mealId = 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c';

function recording(frames = 3): ScaleRecording {
  return {
    captureSessionId: mealId,
    driverId: 'huajun',
    trackerConfig: {
      stabilityToleranceGrams: 1,
      stabilityWindowMs: 1000,
      stableWaitMs: 1500,
      negativeToleranceGrams: 0.3,
    },
    frames: Array.from({ length: frames }, (_, i) => ({
      timestamp: 1000 + i * 225,
      receivedAt: 1_768_460_400_000 + i * 225,
      raw: 'AQIDBAUGBwgJCgsMDQ4PEA==',
      reading: { grams: 312 + i / 10, stable: true },
    })),
    droppedFrames: 0,
    events: [
      { type: 'start', at: 1100, afterFrames: 1 },
      { type: 'next', at: 1500, afterFrames: 2 },
    ],
  };
}

/** `null`: a meal saved without a recording. */
function scaleMeal(withRecording: ScaleRecording | null = recording()): SaveMealRequest {
  return {
    meal: {
      id: mealId,
      recipeId: curdRecipe.id,
      inputMethod: 'scale',
      startedAt: '2026-01-15T07:00:00.000Z',
      finishedAt: '2026-01-15T07:05:00.000Z',
      items: [
        {
          stepId: curdRecipe.steps[0]!.id,
          skipped: false,
          productId: curd.id,
          grams: 212.5,
          weightSource: 'scale',
        },
        { stepId: curdRecipe.steps[1]!.id, skipped: true },
      ],
    },
    consumptionEntry: {
      id: 'c8f4d2b3-5e6a-4f7b-8c9d-8e7f6a5b4c3d',
      eatenAt: '2026-01-15T07:05:00.000Z',
      portion: { type: 'whole' },
    },
    ...(withRecording === null ? {} : { recording: withRecording }),
  };
}

describe('scale recordings (M4-7, M6-7)', () => {
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
    app.request('/api/meals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const exported = (id = mealId) => app.request(`/api/meals/${id}/recording`);
  const recordings = async () => {
    const [row] = await queryRows<{ n: number }>(
      database.db,
      sql`select count(*)::int as n from scale_recordings`,
    );
    return row!.n;
  };

  it('M6-7, M4-7: the recording saved with a meal is exported as JSON', async () => {
    const saved = await post(scaleMeal());
    expect(saved.status).toBe(201);
    // The meal as stored, without the recording echoed back.
    expect(await saved.json()).not.toHaveProperty('recording');

    const response = await exported();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="recording-${mealId}.json"`,
    );
    expect(scaleRecordingSchema.parse(await response.json())).toEqual(recording());
  });

  it('M4-7: a full-length recording is kept whole', async () => {
    const full = recording(MAX_RECORDED_FRAMES);
    expect((await post(scaleMeal(full))).status).toBe(201);
    const back = (await (await exported()).json()) as ScaleRecording;
    expect(back.frames).toHaveLength(MAX_RECORDED_FRAMES);
    expect(back).toEqual(full);
  });

  it('M4-7, M4-6: a retry keeps the one recording', async () => {
    expect((await post(scaleMeal())).status).toBe(201);
    expect((await post(scaleMeal())).status).toBe(200);
    expect(await recordings()).toBe(1);
    expect(await (await exported()).json()).toEqual(recording());
  });

  it('M4-7: a save that is rolled back keeps no recording', async () => {
    expect((await post(scaleMeal())).status).toBe(201);
    // Another meal reusing the saved entry's id: a conflict, so nothing of it is kept.
    const otherId = 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a';
    const other = scaleMeal({ ...recording(), captureSessionId: otherId });
    other.meal.id = otherId;
    expect((await post(other)).status).toBe(409);
    expect(await recordings()).toBe(1);
    expect((await exported(otherId)).status).toBe(404);
  });

  it('M4-7: a meal without a recording has none to export', async () => {
    expect((await post(scaleMeal(null))).status).toBe(201);
    expect((await exported()).status).toBe(404);
    expect(await (await exported()).json()).toEqual({ error: 'not_found' });
  });

  it('M4-7: an unknown meal has no recording', async () => {
    expect((await exported()).status).toBe(404);
  });

  it('M4-4: an invalid meal id in the export path gets 400', async () => {
    expect((await exported('not-a-uuid')).status).toBe(400);
  });

  it('M4-4, M6-7: a recording must belong to the meal it is saved with', async () => {
    const response = await post(
      scaleMeal({ ...recording(), captureSessionId: 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a' }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'invalid_request',
      issues: [
        {
          path: 'recording.captureSessionId',
          message: 'Must be the id of the meal it is saved with.',
        },
      ],
    });
    expect(await recordings()).toBe(0);
  });

  it('M4-4, M6-7: only a meal weighed with the scale has a recording', async () => {
    const direct = scaleMeal();
    direct.meal.inputMethod = 'direct';
    const response = await post(direct);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'invalid_request',
      issues: [
        { path: 'recording', message: 'Only a meal weighed with the scale has a recording.' },
      ],
    });
  });

  it('M4-4: an invalid recording is refused with field-level errors', async () => {
    const response = await post(
      scaleMeal({ ...recording(), frames: [{ ...recording().frames[0]!, raw: 'not base64!' }] }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: { path: string }[] };
    expect(body.issues.map((i) => i.path)).toEqual(['recording.frames.0.raw']);
  });

  it('M4-7, M7-4: deleting the entry keeps the recording with the meal', async () => {
    expect((await post(scaleMeal())).status).toBe(201);
    const entryId = scaleMeal().consumptionEntry.id;
    expect(
      (await app.request(`/api/consumption-entries/${entryId}`, { method: 'DELETE' })).status,
    ).toBe(204);
    expect((await exported()).status).toBe(200);
  });
});
