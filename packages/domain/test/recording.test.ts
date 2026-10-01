import { describe, expect, it } from 'vitest';
import { MAX_RECORDED_FRAMES, scaleRecordingSchema, type ScaleRecording } from '../src/index.js';

const recording: ScaleRecording = {
  captureSessionId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
  driverId: 'huajun',
  trackerConfig: {
    stabilityToleranceGrams: 1,
    stabilityWindowMs: 1000,
    stableWaitMs: 1500,
    negativeToleranceGrams: 0.3,
  },
  frames: [
    {
      timestamp: 1234.5,
      receivedAt: 1_780_000_000_000,
      raw: 'rAUAFIkCyuc=',
      reading: { grams: 525.7, stable: true },
    },
    { timestamp: 1459.5, receivedAt: 1_780_000_000_225, raw: '', reading: {} },
  ],
  droppedFrames: 0,
  events: [
    { type: 'start', at: 1300, afterFrames: 1 },
    { type: 'correct', at: 1400, afterFrames: 1, grams: 20.5 },
    { type: 'next', at: 1500, afterFrames: 2 },
  ],
};

describe('scale recordings (M3-11)', () => {
  it('M3-11: a recording holds each frame (bytes, receive times, parsed reading) and the user events', () => {
    expect(scaleRecordingSchema.parse(recording)).toEqual(recording);
  });

  it('M3-11: raw bytes are base64', () => {
    const frame = { ...recording.frames[0]!, raw: 'not base64!' };
    expect(scaleRecordingSchema.safeParse({ ...recording, frames: [frame] }).success).toBe(false);
  });

  it('M3-11: events are the tracker events, with typed grams only on a correction', () => {
    const bad = [
      [{ type: 'reading', at: 1, afterFrames: 0 }],
      [{ type: 'correct', at: 1, afterFrames: 0 }],
      [{ type: 'correct', at: 1, afterFrames: 0, grams: -1 }],
      [{ type: 'next', at: 1, afterFrames: 0, grams: 3 }],
      [{ type: 'next', at: 1 }],
    ];
    for (const events of bad) {
      expect(
        scaleRecordingSchema.safeParse({ ...recording, events }).success,
        JSON.stringify(events),
      ).toBe(false);
    }
  });

  it('M3-11: a recording has a bounded size', () => {
    const frames = Array.from({ length: MAX_RECORDED_FRAMES + 1 }, () => recording.frames[1]!);
    expect(scaleRecordingSchema.safeParse({ ...recording, frames }).success).toBe(false);
  });
});
