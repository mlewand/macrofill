import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconnect, retryDelay } from '../src/scaleMode/reconnect';
import type { ReconnectSettings } from '../src/scaleMode/settings';

const settings: ReconnectSettings = {
  firstDelayMs: 500,
  maxDelayMs: 10_000,
  giveUpAfterMs: 60_000,
};

describe('reconnect (M6-6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('M6-6: the first attempt is immediate, then the waits double up to the maximum', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => retryDelay(n, settings))).toEqual([
      0, 500, 1000, 2000, 4000, 8000, 10_000, 10_000, 10_000,
    ]);
  });

  it('M6-6: retries with backoff until a connect succeeds', async () => {
    const times: number[] = [];
    const connect = vi.fn(() => {
      times.push(Date.now());
      return times.length < 4 ? Promise.reject(new Error('off')) : Promise.resolve();
    });
    const start = Date.now();
    const result = reconnect(connect, settings, new AbortController().signal);
    await vi.runAllTimersAsync();
    expect(await result).toBe('connected');
    expect(times.map((t) => t - start)).toEqual([0, 500, 1500, 3500]);
  });

  it('M6-6: gives up once the time is up, and starts no attempt after it (regression: #36)', async () => {
    const times: number[] = [];
    const start = Date.now();
    const connect = vi.fn(() => {
      times.push(Date.now() - start);
      return Promise.reject(new Error('off'));
    });
    const result = reconnect(connect, settings, new AbortController().signal);
    await vi.runAllTimersAsync();
    expect(await result).toBe('gaveUp');
    // The next attempt would be at 65.5 s: past the minute, so the wait ends at 60 s instead.
    expect(times).toEqual([0, 500, 1500, 3500, 7500, 15_500, 25_500, 35_500, 45_500, 55_500]);
    expect(Date.now() - start).toBe(60_000);
  });

  it('M6-6: counts the time attempts take', async () => {
    // Each failing attempt takes 10 s, as a BLE connect to a switched-off device can.
    const connect = vi.fn(
      () =>
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
    );
    const result = reconnect(connect, settings, new AbortController().signal);
    await vi.runAllTimersAsync();
    expect(await result).toBe('gaveUp');
    // 0–10, 10.5–20.5, 21.5–31.5, 33.5–43.5 and 47.5–57.5 s; the next would start at 65.5 s.
    expect(connect).toHaveBeenCalledTimes(5);
  });

  it('M6-6: stops when aborted, also while waiting, and makes no further attempt', async () => {
    const controller = new AbortController();
    const connect = vi.fn(() => Promise.reject(new Error('off')));
    const result = reconnect(connect, settings, controller.signal);
    await vi.advanceTimersByTimeAsync(600);
    expect(connect).toHaveBeenCalledTimes(2);
    controller.abort();
    expect(await result).toBe('aborted');
    await vi.runAllTimersAsync();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('M6-6: an attempt that succeeds after an abort still reports aborted', async () => {
    const controller = new AbortController();
    let succeed!: () => void;
    const connect = vi.fn(() => new Promise<void>((resolve) => (succeed = resolve)));
    const result = reconnect(connect, settings, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    succeed();
    expect(await result).toBe('aborted');
  });
});
