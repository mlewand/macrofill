import type { ScaleRecording } from '@macrofill/domain';
import type { ConnectionState, ScaleCapabilities, ScaleDriver, ScaleReading } from './driver.js';
import { replayReadings } from './recording.js';

export interface ReplayOptions {
  /** 1 plays with the original timing; 10 ten times faster. Timestamps are kept as recorded. */
  speed?: number;
  /** Clock in ms for the timing. Default `performance.now()`. */
  now?: () => number;
}

/**
 * M3-11: a driver that plays a recording's re-parsed readings with their original timing (or
 * faster), for investigating a session in the app.
 */
export class ReplayScaleDriver implements ScaleDriver {
  readonly id = 'replay';
  readonly capabilities: ScaleCapabilities = {
    hasStableFlag: true,
    canTare: false,
    resolutionGrams: 0.1,
  };
  readonly #readings: ScaleReading[];
  readonly #speed: number;
  readonly #now: () => number;
  /** When the first reading was played. */
  #startedAt = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #state: ConnectionState = 'disconnected';
  readonly #readingListeners = new Set<(r: ScaleReading) => void>();
  readonly #connectionListeners = new Set<(state: ConnectionState) => void>();

  constructor(recording: ScaleRecording, options: ReplayOptions = {}) {
    this.#readings = replayReadings(recording);
    this.#speed = options.speed ?? 1;
    this.#now = options.now ?? (() => performance.now());
  }

  connect(): Promise<void> {
    this.#setState('connected');
    this.#startedAt = this.#now();
    this.#play(0);
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    clearTimeout(this.#timer);
    this.#setState('disconnected');
    return Promise.resolve();
  }

  onReading(cb: (r: ScaleReading) => void): () => void {
    this.#readingListeners.add(cb);
    return () => this.#readingListeners.delete(cb);
  }

  onConnectionChange(cb: (state: ConnectionState) => void): () => void {
    this.#connectionListeners.add(cb);
    return () => this.#connectionListeners.delete(cb);
  }

  #play(index: number) {
    const reading = this.#readings[index];
    if (!reading || this.#state !== 'connected') return;
    for (const cb of this.#readingListeners) cb(reading);
    const following = this.#readings[index + 1];
    const first = this.#readings[0];
    if (!following || !first) return;
    // From the start, so rounded timer delays don't add up.
    const due = this.#startedAt + (following.timestamp - first.timestamp) / this.#speed;
    this.#timer = setTimeout(() => this.#play(index + 1), Math.max(0, due - this.#now()));
  }

  #setState(state: ConnectionState) {
    if (state === this.#state) return;
    this.#state = state;
    for (const cb of this.#connectionListeners) cb(state);
  }
}
