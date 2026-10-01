import { z } from 'zod';
import { idSchema } from './common.js';

/**
 * M3-11: at most this many frames per recording, about an hour and a quarter at the Huajun scale's
 * 225 ms. Bounds the size of a save request; a longer session counts what it leaves out.
 */
export const MAX_RECORDED_FRAMES = 20_000;

/** One notification from the scale, as received. */
export const recordedFrameSchema = z.object({
  /** ms on the monotonic clock, as `TimedReading.timestamp`. */
  timestamp: z.number(),
  /** ms since the epoch. */
  receivedAt: z.number(),
  /** The payload, base64. Empty for drivers without one (the mock). */
  raw: z.base64(),
  /** What the driver made of it, for reading a recording without re-parsing. */
  reading: z.object({ grams: z.number().optional(), stable: z.boolean().optional() }).strict(),
});

/** The weight tracker's settings (`TrackerConfig`) a session ran with. */
export const trackerConfigSchema = z
  .object({
    stabilityToleranceGrams: z.number().nonnegative(),
    stabilityWindowMs: z.number().nonnegative(),
    stableWaitMs: z.number().nonnegative(),
    negativeToleranceGrams: z.number().nonnegative(),
  })
  .strict();

/** A user event given to the weight tracker, at `at` ms on the monotonic clock. */
export const recordedEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['start', 'next', 'confirm', 'skip', 'undo']), at: z.number() }).strict(),
  z
    .object({ type: z.literal('correct'), at: z.number(), grams: z.number().nonnegative() })
    .strict(),
]);

/**
 * M3-11: everything a Scale Mode capture session got from the scale (frames the parser rejected
 * included, with an empty reading) and the user, so it can be
 * replayed (re-parsed with the library's current parser) and investigated.
 */
export const scaleRecordingSchema = z.object({
  /** The capture session: the prepared meal's id. */
  captureSessionId: idSchema,
  /** `ScaleDriver.id`, e.g. `huajun`. */
  driverId: z.string().min(1),
  /** The tracker's settings in the session, so a replay after a retune still matches it. */
  trackerConfig: trackerConfigSchema,
  frames: z.array(recordedFrameSchema).max(MAX_RECORDED_FRAMES),
  /** Frames left out past `MAX_RECORDED_FRAMES`: if any, a replay can't match the session. */
  droppedFrames: z.number().int().nonnegative(),
  events: z.array(recordedEventSchema),
});

export type RecordedFrame = z.infer<typeof recordedFrameSchema>;
export type RecordedEvent = z.infer<typeof recordedEventSchema>;
export type ScaleRecording = z.infer<typeof scaleRecordingSchema>;
