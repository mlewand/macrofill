import { Scale, type Reading, type ScaleTransport } from '@mlewand/huajun-ble-scale';
import { CapacitorTransport } from '@mlewand/huajun-ble-scale/capacitor';
import type { ConnectionState, ScaleCapabilities, ScaleDriver, ScaleReading } from './driver.js';

export interface HuajunDriverOptions {
  /**
   * A new BLE transport per connection, for `deviceId` if one was connected before, else through
   * the device chooser. Default: the Capacitor transport, which on the web uses Web Bluetooth.
   */
  transport?: (deviceId: string | undefined) => ScaleTransport;
  /** Monotonic clock for reading timestamps. Default: the library's, `performance.now()`. */
  monotonicNow?: () => number;
}

/**
 * M3-13: maps the library's reading to a driver reading. The library decodes the bytes; a reading
 * in another unit has no grams (M3-14).
 */
export function toScaleReading(reading: Reading): ScaleReading {
  const mapped: ScaleReading = { timestamp: reading.receivedAtMonotonic, raw: reading.raw };
  if (reading.grams !== undefined) mapped.grams = reading.grams;
  if (reading.stable !== undefined) mapped.stable = reading.stable;
  return mapped;
}

/** The driver for Huajun kitchen scales, an adapter over `@mlewand/huajun-ble-scale`. */
export class HuajunDriver implements ScaleDriver {
  readonly id = 'huajun';
  /** The library is read-only, so no tare. It reports stability and 0.1 g steps. */
  readonly capabilities: ScaleCapabilities = {
    hasStableFlag: true,
    canTare: false,
    resolutionGrams: 0.1,
  };
  readonly #transport: (deviceId: string | undefined) => ScaleTransport;
  /** The device picked on the first successful connect (M6-6). */
  #deviceId: string | undefined;
  readonly #monotonicNow: (() => number) | undefined;
  #scale: Scale | undefined;
  #state: ConnectionState = 'disconnected';
  readonly #readingListeners = new Set<(r: ScaleReading) => void>();
  readonly #connectionListeners = new Set<(state: ConnectionState) => void>();

  constructor(options: HuajunDriverOptions = {}) {
    // M6-1: Chrome's name filter doesn't match this scale, so the chooser lists all devices.
    // M6-6: later connections go to the device picked first, without the chooser.
    this.#transport =
      options.transport ??
      ((deviceId) =>
        new CapacitorTransport(deviceId === undefined ? { showAllDevices: true } : { deviceId }));
    this.#monotonicNow = options.monotonicNow;
  }

  /**
   * The first call must come from a user gesture: the transport opens the device chooser first
   * thing. Once a device was connected, later calls reconnect to it without the chooser (M6-6).
   */
  async connect(): Promise<void> {
    // One `Scale` per connection, as the library requires.
    const transport = this.#transport(this.#deviceId);
    const scale = new Scale(
      transport,
      this.#monotonicNow ? { monotonicNow: this.#monotonicNow } : {},
    );
    // Close the connection this one replaces, if any. Not awaited: the chooser needs the gesture.
    const replaced = this.#scale;
    this.#scale = scale;
    void replaced?.disconnect().catch(() => undefined);
    scale.onReading((reading) => {
      if (this.#scale !== scale) return;
      const mapped = toScaleReading(reading);
      for (const cb of this.#readingListeners) cb(mapped);
    });
    scale.onDisconnect(() => {
      if (this.#scale === scale) this.#setState('disconnected');
    });
    try {
      await scale.connect();
    } catch (error) {
      // Nothing to disconnect later, and the state doesn't depend on the library's callback.
      if (this.#scale === scale) {
        this.#scale = undefined;
        this.#setState('disconnected');
      }
      throw error;
    }
    this.#deviceId ??= deviceIdOf(transport);
    // A newer connect() replaced this one meanwhile: let that one report, and don't leak this one.
    if (this.#scale !== scale) return scale.disconnect();
    this.#setState('connected');
  }

  async disconnect(): Promise<void> {
    // Cancel the current attempt first: a connect() still in progress then closes itself when it
    // completes, instead of reporting `connected`.
    const scale = this.#scale;
    this.#scale = undefined;
    try {
      await scale?.disconnect();
    } finally {
      // Also when the teardown fails: this driver no longer uses that scale. A connect() started
      // meanwhile owns the state now; a failed one reports it itself.
      if (this.#scale === undefined) this.#setState('disconnected');
    }
  }

  onReading(cb: (r: ScaleReading) => void): () => void {
    this.#readingListeners.add(cb);
    return () => this.#readingListeners.delete(cb);
  }

  onConnectionChange(cb: (state: ConnectionState) => void): () => void {
    this.#connectionListeners.add(cb);
    return () => this.#connectionListeners.delete(cb);
  }

  #setState(state: ConnectionState) {
    if (state === this.#state) return;
    this.#state = state;
    for (const cb of this.#connectionListeners) cb(state);
  }
}

/** The connected device's ID, for transports that have one (the Capacitor transport does). */
function deviceIdOf(transport: ScaleTransport): string | undefined {
  const id = (transport as { deviceId?: unknown }).deviceId;
  return typeof id === 'string' ? id : undefined;
}
