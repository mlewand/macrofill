import {
  createTracker,
  MAX_RECORDED_FRAMES,
  track,
  type RecordedEvent,
  type RecordedFrame,
  type ScaleRecording,
  type TrackerConfig,
  type TrackerEvent,
  type TrackerState,
} from '@macrofill/domain';
import { parseFrame, toReading } from '@mlewand/huajun-ble-scale';
import type { RejectedFrame, ScaleDriver, ScaleReading } from './driver.js';
import { toScaleReading } from './reading.js';

/** A user event as the tracker gets it. */
export type UserEvent = Exclude<TrackerEvent, { type: 'reading' }>;

/**
 * M3-11: records a capture session: every frame the driver delivers (bytes, both receive times and
 * the parsed reading) and every user event, with its time on the same monotonic clock.
 */
export class SessionRecorder {
  readonly #frames: RecordedFrame[] = [];
  readonly #events: RecordedEvent[] = [];
  #dropped = 0;

  constructor(
    readonly captureSessionId: string,
    readonly driverId: string,
    /** Frames past this are dropped, so a very long session still saves. */
    readonly maxFrames = MAX_RECORDED_FRAMES,
  ) {}

  /**
   * Records every frame `driver` delivers until the returned function is called: its readings, and
   * the payloads it couldn't parse, so a parser fix can be checked against them.
   */
  record(driver: Pick<ScaleDriver, 'onReading' | 'onRejectedFrame'>): () => void {
    const offReading = driver.onReading((reading) => this.frame(reading));
    const offRejected = driver.onRejectedFrame?.((frame) => this.rejected(frame));
    return () => {
      offReading();
      offRejected?.();
    };
  }

  /** A payload that parsed into no reading. */
  rejected(frame: RejectedFrame): void {
    this.#push({
      timestamp: frame.timestamp,
      receivedAt: frame.receivedAt,
      raw: toBase64(frame.raw),
      reading: {},
    });
  }

  #push(frame: RecordedFrame) {
    if (this.#frames.length >= this.maxFrames) this.#dropped++;
    else this.#frames.push(frame);
  }

  frame(reading: ScaleReading): void {
    const parsed: RecordedFrame['reading'] = {};
    if (reading.grams !== undefined) parsed.grams = reading.grams;
    if (reading.stable !== undefined) parsed.stable = reading.stable;
    this.#push({
      timestamp: reading.timestamp,
      receivedAt: reading.receivedAt,
      raw: toBase64(reading.raw),
      reading: parsed,
    });
  }

  /** A user event given to the tracker at `at` ms on the readings' monotonic clock. */
  event(event: UserEvent, at: number): void {
    this.#events.push({ ...event, at });
  }

  recording(): ScaleRecording {
    return {
      captureSessionId: this.captureSessionId,
      driverId: this.driverId,
      frames: [...this.#frames],
      droppedFrames: this.#dropped,
      events: [...this.#events],
    };
  }
}

/**
 * M3-11: the readings of a recording, re-parsed from the stored bytes with the library's current
 * parser, so a parser fix shows in old recordings. Frames the parser rejects are left out. Frames
 * without bytes (from the mock) give their stored reading.
 */
export function replayReadings(recording: ScaleRecording): ScaleReading[] {
  return recording.frames.flatMap((frame): ScaleReading[] => {
    const raw = fromBase64(frame.raw);
    if (raw.length === 0) {
      const reading: ScaleReading = {
        timestamp: frame.timestamp,
        receivedAt: frame.receivedAt,
        raw,
      };
      if (frame.reading.grams !== undefined) reading.grams = frame.reading.grams;
      if (frame.reading.stable !== undefined) reading.stable = frame.reading.stable;
      return [reading];
    }
    const parsed = parseFrame(raw);
    if (!parsed.ok) return [];
    return [
      toScaleReading(
        toReading(parsed.frame, {
          receivedAt: frame.receivedAt,
          receivedAtMonotonic: frame.timestamp,
        }),
      ),
    ];
  });
}

/**
 * M3-11: the tracker's state after replaying a recording: its re-parsed readings and its user
 * events, in the order they happened (a reading first, when both have the same time).
 */
export function replaySession(
  recording: ScaleRecording,
  config?: Partial<TrackerConfig>,
): TrackerState {
  let state = createTracker(config);
  const events = [...recording.events].sort((a, b) => a.at - b.at);
  let next = 0;
  const userEventsUntil = (time: number) => {
    while (next < events.length && events[next]!.at < time) {
      const event = events[next++]!;
      state = track(
        state,
        event.type === 'correct' ? { type: 'correct', grams: event.grams } : { type: event.type },
      );
    }
  };
  for (const reading of replayReadings(recording)) {
    userEventsUntil(reading.timestamp);
    state = track(state, { type: 'reading', reading });
  }
  userEventsUntil(Infinity);
  return state;
}

/** Bytes as base64, for the recording's JSON. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
