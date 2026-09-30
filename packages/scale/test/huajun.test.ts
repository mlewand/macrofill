import type { Reading, ScaleTransport } from '@mlewand/huajun-ble-scale';
import { describe, expect, it, vi } from 'vitest';
import { HuajunDriver, toScaleReading } from '../src/huajun.js';
import type { ScaleReading } from '../src/index.js';

const capacitor = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock('@mlewand/huajun-ble-scale/capacitor', () => ({
  CapacitorTransport: class {
    constructor(options: unknown) {
      capacitor.options.push(options);
    }
  },
}));

const raw = new Uint8Array([0xac, 0x05, 0x00, 0x14, 0x89, 0x02, 0xca, 0xe7]);

describe('toScaleReading', () => {
  it("M3-13: maps the library's reading: grams, stable flag, monotonic time and raw bytes", () => {
    const reading: Reading = {
      grams: 525.7,
      value: 525.7,
      unit: 'g',
      stable: true,
      raw,
      receivedAt: 1_780_000_000_000,
      receivedAtMonotonic: 1234.5,
    };
    expect(toScaleReading(reading)).toEqual({
      grams: 525.7,
      stable: true,
      timestamp: 1234.5,
      raw,
    });
  });

  it('M3-13: leaves out what the library leaves out', () => {
    expect(toScaleReading({ raw, receivedAt: 0, receivedAtMonotonic: 5 })).toEqual({
      timestamp: 5,
      raw,
    });
  });

  it('M3-14: a reading in another unit has no grams', () => {
    const reading: Reading = {
      value: 1.2,
      unit: 'oz',
      stable: true,
      raw,
      receivedAt: 0,
      receivedAtMonotonic: 5,
    };
    expect(toScaleReading(reading)).toEqual({ stable: true, timestamp: 5, raw });
  });
});

/** A BLE transport that the test drives: frames in, drops out. */
class FakeTransport implements ScaleTransport {
  onData: ((data: Uint8Array) => void) | undefined;
  #onDisconnect: (() => void)[] = [];
  failConnect = false;
  connect() {
    return this.failConnect ? Promise.reject(new Error('no device')) : Promise.resolve();
  }
  disconnects = 0;
  disconnect() {
    this.disconnects++;
    this.drop();
    return Promise.resolve();
  }
  subscribe(_characteristic: string, onData: (data: Uint8Array) => void) {
    this.onData = onData;
    return Promise.resolve();
  }
  onDisconnect(cb: () => void) {
    this.#onDisconnect.push(cb);
  }
  drop() {
    for (const cb of this.#onDisconnect.splice(0)) cb();
  }
}

function driverWith(transports: FakeTransport[]) {
  let clock = 0;
  const driver = new HuajunDriver({
    transport: () => transports.shift()!,
    monotonicNow: () => (clock += 225),
  });
  const readings: ScaleReading[] = [];
  const states: string[] = [];
  driver.onReading((r) => readings.push(r));
  driver.onConnectionChange((s) => states.push(s));
  return { driver, readings, states };
}

describe('HuajunDriver', () => {
  it('M3-13: delivers the scale frames as readings, and reports the connection', async () => {
    const transport = new FakeTransport();
    const { driver, readings, states } = driverWith([transport]);
    await driver.connect();
    expect(states).toEqual(['connected']);
    // What the frames decode to is the library's business (M3-13); the mapping is tested above.
    const other = new Uint8Array([0xac, 0x05, 0x00, 0x00, 0x0c, 0x22, 0xca, 0x70]);
    transport.onData!(raw);
    transport.onData!(other);
    expect(readings.map((r) => [r.raw, r.timestamp])).toEqual([
      [raw, 225],
      [other, 450],
    ]);
    transport.drop();
    expect(states).toEqual(['connected', 'disconnected']);
  });

  it('a new connection uses a new transport, and the old one is ignored', async () => {
    const [first, second] = [new FakeTransport(), new FakeTransport()];
    const { driver, readings, states } = driverWith([first, second]);
    await driver.connect();
    await driver.disconnect();
    await driver.connect();
    first.onData?.(raw);
    second.onData!(raw);
    expect(readings).toHaveLength(1);
    expect(states).toEqual(['connected', 'disconnected', 'connected']);
  });

  it('an older connect that finishes late reports nothing (regression: #25)', async () => {
    const slow = new FakeTransport();
    let finishSlow = () => {};
    slow.connect = () => new Promise<void>((resolve) => (finishSlow = resolve));
    const failing = new FakeTransport();
    failing.failConnect = true;
    const { driver, states } = driverWith([slow, failing]);
    const first = driver.connect();
    await expect(driver.connect()).rejects.toThrow('no device');
    finishSlow();
    await first;
    expect(states).toEqual([]);
  });

  it('a disconnect while connecting cancels the connection (regression: #25)', async () => {
    const slow = new FakeTransport();
    let finishSlow = () => {};
    slow.connect = () => new Promise<void>((resolve) => (finishSlow = resolve));
    const { driver, states } = driverWith([slow]);
    const pending = driver.connect();
    await driver.disconnect();
    finishSlow();
    await pending;
    expect(states).toEqual([]);
    expect(slow.disconnects).toBeGreaterThan(0);
  });

  it('a disconnect that finishes after a new connect leaves it connected (regression: #25)', async () => {
    const [first, second] = [new FakeTransport(), new FakeTransport()];
    let finishDisconnect = () => {};
    first.disconnect = () =>
      new Promise<void>((resolve) => {
        finishDisconnect = () => {
          first.drop();
          resolve();
        };
      });
    const { driver, readings, states } = driverWith([first, second]);
    await driver.connect();
    const disconnecting = driver.disconnect();
    await driver.connect();
    finishDisconnect();
    await disconnecting;
    expect(states.at(-1)).toBe('connected');
    second.onData!(raw);
    expect(readings).toHaveLength(1);
  });

  it('a failed connect rejects and stays disconnected', async () => {
    const transport = new FakeTransport();
    transport.failConnect = true;
    const { driver, states } = driverWith([transport]);
    await expect(driver.connect()).rejects.toThrow('no device');
    expect(states).toEqual([]);
  });

  it('M6-1: by default the device chooser lists all devices, since Chrome can’t filter this scale by name', () => {
    const driver = new HuajunDriver();
    expect(driver.capabilities).toEqual({
      hasStableFlag: true,
      canTare: false,
      resolutionGrams: 0.1,
    });
    void driver.connect().catch(() => undefined);
    expect(capacitor.options).toEqual([{ showAllDevices: true }]);
  });
});
