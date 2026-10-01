import type { TimedReading } from '@macrofill/domain';

/** A reading from a scale driver: what the tracker needs, plus the payload it came from. */
export interface ScaleReading extends TimedReading {
  /** ms since the epoch, when it was received; `timestamp` is the monotonic time (M3-11). */
  receivedAt: number;
  /** The original payload, kept for recording and replay. */
  raw: Uint8Array;
}

export interface ScaleCapabilities {
  hasStableFlag: boolean;
  canTare: boolean;
  resolutionGrams: number;
}

export type ConnectionState = 'connected' | 'disconnected';

/** A payload the driver couldn't parse, with its receive times (M3-11). */
export interface RejectedFrame {
  raw: Uint8Array;
  timestamp: number;
  receivedAt: number;
}

/** The scale abstraction every driver implements (see "Scale driver abstraction" in the requirements). */
export interface ScaleDriver {
  readonly id: string;
  readonly capabilities: ScaleCapabilities;
  /** Must be called from a user gesture. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onReading(cb: (r: ScaleReading) => void): () => void;
  onConnectionChange(cb: (state: ConnectionState) => void): () => void;
  /** Payloads that parse into no reading, for recording (M3-11). Drivers without bytes omit it. */
  onRejectedFrame?(cb: (frame: RejectedFrame) => void): () => void;
  tare?(): Promise<void>;
}

/** M3-14: a reading without grams means the scale shows another unit: the driver's wrong-unit state. */
export function isWrongUnit(reading: Pick<TimedReading, 'grams'>): boolean {
  return reading.grams === undefined;
}
