import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockScaleDriver, isWrongUnit, scaleScript, type ScaleReading } from '../src/index.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function connected(options: ConstructorParameters<typeof MockScaleDriver>[0] = {}) {
  const driver = new MockScaleDriver({ now: () => Date.now(), ...options });
  const readings: ScaleReading[] = [];
  const states: string[] = [];
  driver.onReading((r) => readings.push(r));
  driver.onConnectionChange((s) => states.push(s));
  return { driver, readings, states };
}

describe('MockScaleDriver', () => {
  it('M3-12: plays a script with its timing, from the moment it is played', async () => {
    const { driver, readings } = connected();
    await driver.connect();
    const start = Date.now();
    const played = driver.play(scaleScript().baseline(312, { forMs: 450 }).build());
    expect(readings).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(225);
    expect(readings).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(225);
    await played;
    expect(readings.map((r) => [r.timestamp - start, r.grams, r.stable])).toEqual([
      [0, 312, true],
      [225, 312, true],
      [450, 312, true],
    ]);
    expect(readings.every((r) => r.raw instanceof Uint8Array)).toBe(true);
  });

  it('M3-12: plays the script it was created with on connect', async () => {
    const { driver, readings } = connected({ readings: scaleScript().baseline(312).build() });
    expect(readings).toEqual([]);
    await driver.connect();
    await vi.runAllTimersAsync();
    expect(readings.length).toBeGreaterThan(1);
  });

  it('M3-12: segments played one after another run on in time', async () => {
    const { driver, readings } = connected();
    await driver.connect();
    const script = scaleScript().baseline(312, { forMs: 0 });
    void driver.play(script.take());
    void driver.play(script.add(214).take());
    await vi.runAllTimersAsync();
    expect(readings.map((r) => r.grams)).toEqual([312, 526]);
    expect(readings[1]!.timestamp).toBeGreaterThan(readings[0]!.timestamp);
  });

  it('reports connection changes, and stops playing on disconnect or a drop', async () => {
    const { driver, readings, states } = connected();
    await driver.connect();
    const played = driver.play(scaleScript().baseline(312, { forMs: 2000 }).build());
    await vi.advanceTimersByTimeAsync(225);
    driver.drop();
    await played;
    await vi.runAllTimersAsync();
    expect(readings).toHaveLength(2);
    expect(states).toEqual(['connected', 'disconnected']);
    await driver.connect();
    await driver.disconnect();
    expect(states).toEqual(['connected', 'disconnected', 'connected', 'disconnected']);
  });

  it('refuses to play while disconnected', async () => {
    const { driver } = connected();
    await expect(driver.play(scaleScript().baseline(312).build())).rejects.toThrow();
  });

  it('stops calling a listener after it unsubscribes', async () => {
    const driver = new MockScaleDriver({ now: () => Date.now() });
    const seen: ScaleReading[] = [];
    const off = driver.onReading((r) => seen.push(r));
    await driver.connect();
    off();
    await driver.play(scaleScript().baseline(312, { forMs: 0 }).build());
    expect(seen).toEqual([]);
  });

  it('has a stable flag and no tare, unless told otherwise', () => {
    expect(new MockScaleDriver().capabilities).toEqual({
      hasStableFlag: true,
      canTare: false,
      resolutionGrams: 0.1,
    });
    expect(
      new MockScaleDriver({ capabilities: { hasStableFlag: false } }).capabilities.hasStableFlag,
    ).toBe(false);
  });

  it('M3-14: a reading without grams means the scale shows another unit', async () => {
    const { driver, readings } = connected();
    await driver.connect();
    void driver.play(scaleScript().baseline(312, { forMs: 0 }).wrongUnit({ forMs: 0 }).build());
    await vi.runAllTimersAsync();
    expect(readings.map(isWrongUnit)).toEqual([false, true]);
  });
});
