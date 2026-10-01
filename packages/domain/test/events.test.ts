import { describe, expect, it } from 'vitest';
import {
  MAX_EVENT_BATCH,
  usageEventBatchSchema,
  usageEventSchema,
  type UsageEvent,
} from '../src/index.js';

const base = {
  id: 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b',
  clientSessionId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  occurredAt: '2026-01-15T07:00:00.000Z',
  appVersion: 'abc1234',
};

describe('usage event catalog (M7-8, M4-10)', () => {
  it('M7-8: accepts each MVP0 event with its props', () => {
    const events: UsageEvent[] = [
      { ...base, name: 'flow_started', props: { inputMethod: 'scale' } },
      { ...base, name: 'flow_finished', props: { inputMethod: 'direct', durationMs: 120_000 } },
      { ...base, name: 'flow_abandoned', props: { inputMethod: 'direct', durationMs: 5000 } },
      {
        ...base,
        name: 'step_completed',
        props: { inputMethod: 'scale', step: 0, durationMs: 8000, weightSource: 'scale' },
      },
      { ...base, name: 'step_skipped', props: { inputMethod: 'scale', step: 1 } },
      { ...base, name: 'step_undone', props: { inputMethod: 'direct', step: 1 } },
      { ...base, name: 'manual_correction', props: { inputMethod: 'scale', step: 2 } },
      { ...base, name: 'scale_disconnected', props: {} },
      { ...base, name: 'scale_reconnected', props: { durationMs: 4000 } },
    ];
    for (const event of events) expect(usageEventSchema.parse(event)).toEqual(event);
  });

  it('M4-10: rejects names and props outside the catalog', () => {
    const bad = [
      { ...base, name: 'page_viewed', props: {} },
      { ...base, name: 'flow_started', props: {} },
      { ...base, name: 'flow_started', props: { inputMethod: 'scale', extra: 1 } },
      {
        ...base,
        name: 'step_completed',
        props: { inputMethod: 'scale', step: -1, durationMs: 1, weightSource: 'scale' },
      },
      { ...base, name: 'flow_finished', props: { inputMethod: 'direct', durationMs: -5 } },
      { ...base, id: 'x', name: 'scale_disconnected', props: {} },
    ];
    for (const event of bad) {
      expect(usageEventSchema.safeParse(event).success, JSON.stringify(event)).toBe(false);
    }
  });

  it('M4-10: a batch has 1 to MAX_EVENT_BATCH events', () => {
    const event = { ...base, name: 'scale_disconnected', props: {} };
    expect(usageEventBatchSchema.safeParse({ events: [] }).success).toBe(false);
    expect(usageEventBatchSchema.safeParse({ events: [event] }).success).toBe(true);
    const tooMany = Array.from({ length: MAX_EVENT_BATCH + 1 }, () => event);
    expect(usageEventBatchSchema.safeParse({ events: tooMany }).success).toBe(false);
  });
});
