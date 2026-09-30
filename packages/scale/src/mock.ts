import type { TimedReading } from '@macrofill/domain';
import type { ConnectionState, ScaleCapabilities, ScaleDriver, ScaleReading } from './driver.js';

export interface MockScaleOptions {
  /** A script to play on connect, e.g. `scaleScript()...build()`. */
  readings?: TimedReading[];
  /** The mock has no tare, so it never claims one. */
  capabilities?: Partial<Omit<ScaleCapabilities, 'canTare'>>;
  /** Monotonic clock in ms. Default `performance.now()`. */
  now?: () => number;
}

interface Segment {
  readings: TimedReading[];
  /** Added to a script timestamp to get the time it's played at. */
  shift: number;
  done: () => void;
}

/**
 * Plays readings from `scaleScript()` with their timing (M3-12). Used in tests, in e2e and for
 * development without the scale. Segments played one after another queue up; a segment that
 * continues the previous one's script (from `take()`) keeps its spacing.
 */
export class MockScaleDriver implements ScaleDriver {
  readonly id = 'mock';
  readonly capabilities: ScaleCapabilities;
  readonly #initial: TimedReading[] | undefined;
  readonly #now: () => number;
  #state: ConnectionState = 'disconnected';
  #segments: Segment[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** The last reading played: when, and its script timestamp. */
  #last: { at: number; scriptTime: number } | undefined;
  readonly #readingListeners = new Set<(r: ScaleReading) => void>();
  /** While false, `connect()` fails, like a scale that is off or out of range (M6-6). */
  available = true;
  readonly #connectionListeners = new Set<(state: ConnectionState) => void>();

  constructor(options: MockScaleOptions = {}) {
    this.capabilities = {
      hasStableFlag: options.capabilities?.hasStableFlag ?? true,
      canTare: false,
      resolutionGrams: options.capabilities?.resolutionGrams ?? 0.1,
    };
    this.#initial = options.readings;
    this.#now = options.now ?? (() => performance.now());
  }

  connect(): Promise<void> {
    if (!this.available) return Promise.reject(new Error('The mock scale is unavailable.'));
    this.#setState('connected');
    if (this.#initial) void this.play(this.#initial);
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.drop();
    return Promise.resolve();
  }

  /** The scale goes away by itself, e.g. auto-off. */
  drop(): void {
    clearTimeout(this.#timer);
    const segments = this.#segments;
    this.#segments = [];
    for (const segment of segments) segment.done();
    this.#setState('disconnected');
  }

  /** Plays readings after any still playing. Resolves once played, or on disconnect. */
  play(readings: TimedReading[]): Promise<void> {
    if (this.#state !== 'connected') {
      return Promise.reject(new Error('The mock scale is not connected.'));
    }
    return new Promise((done) => {
      this.#segments.push({ readings, shift: 0, done });
      if (this.#segments.length === 1) this.#startSegment();
    });
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

  #startSegment() {
    const segment = this.#segments[0];
    if (!segment) return;
    const first = segment.readings[0];
    const now = this.#now();
    let start = now;
    if (first && this.#last && first.timestamp > this.#last.scriptTime) {
      start = Math.max(now, this.#last.at + first.timestamp - this.#last.scriptTime);
    }
    segment.shift = start - (first?.timestamp ?? 0);
    this.#playFrom(0);
  }

  #playFrom(index: number) {
    const segment = this.#segments[0];
    if (!segment) return;
    for (let i = index; i < segment.readings.length; i++) {
      const reading = segment.readings[i]!;
      const at = segment.shift + reading.timestamp;
      const delay = at - this.#now();
      if (delay > 0) {
        this.#timer = setTimeout(() => this.#playFrom(i), delay);
        return;
      }
      this.#last = { at, scriptTime: reading.timestamp };
      const played: ScaleReading = { ...reading, timestamp: at, raw: new Uint8Array(0) };
      // A scale without the flag never reports it, whatever the script says (M3-5).
      if (!this.capabilities.hasStableFlag) delete played.stable;
      for (const cb of this.#readingListeners) cb(played);
    }
    this.#segments.shift();
    segment.done();
    this.#startSegment();
  }
}
