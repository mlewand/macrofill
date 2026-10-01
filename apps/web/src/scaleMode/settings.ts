import { defaultTrackerConfig, type TrackerConfig } from '@macrofill/domain';

/**
 * Weight tracker settings for Scale Mode, in one place for tuning on the real scale: stability
 * tolerance and window (M3-5), the wait for a stable Next (M3-4), and how far below 0 an amount
 * counts as 0 (M3-6).
 */
export const trackerSettings: TrackerConfig = { ...defaultTrackerConfig };

/**
 * M6-6: reconnecting after the scale drops. The first attempt is immediate, then the waits double
 * from `firstDelayMs` up to `maxDelayMs`. After `giveUpAfterMs` without success, the rest of the
 * meal takes typed grams. Long enough to turn a scale back on that switched itself off.
 */
export interface ReconnectSettings {
  firstDelayMs: number;
  maxDelayMs: number;
  giveUpAfterMs: number;
}

export const reconnectSettings: ReconnectSettings = {
  firstDelayMs: 500,
  maxDelayMs: 10_000,
  giveUpAfterMs: 120_000,
};
