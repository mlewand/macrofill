import type { UsageEvent } from '@macrofill/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUsageTracker } from '../src/events/track';

describe('usage tracking (M7-8)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T07:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  let ids = 0;
  const setup = (
    send = vi.fn<(events: UsageEvent[]) => Promise<void>>(() => Promise.resolve()),
  ) => {
    const tracker = createUsageTracker({
      send,
      appVersion: 'abc1234',
      clientSessionId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      newId: () => `f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a${String(++ids).padStart(2, '0')}`,
      flushAfterMs: 5000,
      batchSize: 3,
    });
    return { tracker, send };
  };

  it('M7-8: batches events and sends them a few seconds later', async () => {
    const { tracker, send } = setup();
    tracker.track('flow_started', { inputMethod: 'direct' });
    tracker.track('step_skipped', { inputMethod: 'direct', step: 0 });
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);
    const [events] = send.mock.calls[0]!;
    expect(events.map((e) => [e.name, e.props])).toEqual([
      ['flow_started', { inputMethod: 'direct' }],
      ['step_skipped', { inputMethod: 'direct', step: 0 }],
    ]);
    expect(events[0]).toMatchObject({
      clientSessionId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      appVersion: 'abc1234',
      occurredAt: '2026-01-15T07:00:00.000Z',
    });
    expect(new Set(events.map((e) => e.id)).size).toBe(2);
  });

  it('M7-8: a full batch is sent at once', async () => {
    const { tracker, send } = setup();
    for (let i = 0; i < 3; i++) tracker.track('step_undone', { inputMethod: 'scale', step: i });
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('M7-8: tracking never throws and never blocks, even when sending fails; failed events are sent later', async () => {
    const send = vi.fn<(events: UsageEvent[]) => Promise<void>>(() =>
      Promise.reject(new Error('offline')),
    );
    const { tracker } = setup(send);
    expect(() => tracker.track('scale_disconnected', {})).not.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);
    send.mockImplementation(() => Promise.resolve());
    tracker.track('scale_reconnected', { durationMs: 1200 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(send.mock.calls[1]![0].map((e) => e.name)).toEqual([
      'scale_disconnected',
      'scale_reconnected',
    ]);
  });

  it('M7-8: a send that throws synchronously is caught too', async () => {
    const send = vi.fn<(events: UsageEvent[]) => Promise<void>>((): Promise<void> => {
      throw new Error('boom');
    });
    const { tracker } = setup(send);
    tracker.track('scale_disconnected', {});
    await expect(tracker.flush()).resolves.toBeUndefined();
  });

  it('M7-8: flush sends what is waiting right away, e.g. when the page is hidden', async () => {
    const { tracker, send } = setup();
    tracker.track('flow_abandoned', { inputMethod: 'scale', durationMs: 9000 });
    await tracker.flush();
    expect(send).toHaveBeenCalledTimes(1);
    await tracker.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('M7-8: while sending fails, it keeps at most a bounded number of events, dropping the oldest', async () => {
    const send = vi.fn<(events: UsageEvent[]) => Promise<void>>(() =>
      Promise.reject(new Error('offline')),
    );
    const tracker = createUsageTracker({
      send,
      appVersion: 'dev',
      clientSessionId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      newId: () => crypto.randomUUID(),
      flushAfterMs: 5000,
      batchSize: 100,
      maxQueued: 4,
    });
    for (let i = 0; i < 6; i++) tracker.track('step_skipped', { inputMethod: 'direct', step: i });
    await tracker.flush();
    send.mockImplementation(() => Promise.resolve());
    await tracker.flush();
    expect(send.mock.calls.at(-1)![0].map((e) => e.props)).toEqual(
      [2, 3, 4, 5].map((step) => ({ inputMethod: 'direct', step })),
    );
  });
});
