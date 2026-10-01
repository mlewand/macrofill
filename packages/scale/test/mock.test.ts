import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isWrongUnit, scaleScript, type ScaleReading } from '../src/index.js';
import { MockScaleDriver } from '../src/mock.js';

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
    // M3-11: the wall-clock receive time too.
    expect(readings.map((r) => r.receivedAt - start)).toEqual([0, 225, 450]);
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

  it('M3-12: reports connection changes, and stops playing on disconnect or a drop', async () => {
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

  it('M6-6: while unavailable, connecting fails, as for a scale that is off; then it reconnects', async () => {
    const { driver, states } = connected();
    await driver.connect();
    driver.available = false;
    driver.drop();
    await expect(driver.connect()).rejects.toThrow('unavailable');
    expect(states).toEqual(['connected', 'disconnected']);
    driver.available = true;
    await driver.connect();
    expect(states).toEqual(['connected', 'disconnected', 'connected']);
  });

  it('M3-12: refuses to play while disconnected', async () => {
    const { driver } = connected();
    await expect(driver.play(scaleScript().baseline(312).build())).rejects.toThrow();
  });

  it('M3-12: stops calling a listener after it unsubscribes', async () => {
    const driver = new MockScaleDriver({ now: () => Date.now() });
    const seen: ScaleReading[] = [];
    const off = driver.onReading((r) => seen.push(r));
    await driver.connect();
    off();
    await driver.play(scaleScript().baseline(312, { forMs: 0 }).build());
    expect(seen).toEqual([]);
  });

  it('M3-12: has a stable flag and no tare, unless told otherwise', () => {
    expect(new MockScaleDriver().capabilities).toEqual({
      hasStableFlag: true,
      canTare: false,
      resolutionGrams: 0.1,
    });
    expect(
      new MockScaleDriver({ capabilities: { hasStableFlag: false } }).capabilities.hasStableFlag,
    ).toBe(false);
  });

  it('M3-5: a mock without a stable flag drops the flag from its script (regression: #24)', async () => {
    const { driver, readings } = connected({ capabilities: { hasStableFlag: false } });
    await driver.connect();
    void driver.play(scaleScript().baseline(312, { forMs: 225 }).add(5).build());
    await vi.runAllTimersAsync();
    expect(readings).toHaveLength(3);
    expect(readings.every((r) => !('stable' in r))).toBe(true);
  });

  it('M3-12: never claims tare, since it has none (regression: #24)', () => {
    // @ts-expect-error: canTare is not an option.
    const driver = new MockScaleDriver({ capabilities: { canTare: true } });
    expect(driver.capabilities.canTare).toBe(false);
    expect('tare' in driver).toBe(false);
  });

  it('M3-14: a reading without grams means the scale shows another unit', async () => {
    const { driver, readings } = connected();
    await driver.connect();
    void driver.play(scaleScript().baseline(312, { forMs: 0 }).wrongUnit({ forMs: 0 }).build());
    await vi.runAllTimersAsync();
    expect(readings.map(isWrongUnit)).toEqual([false, true]);
  });
});
