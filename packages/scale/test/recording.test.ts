import {
  createTracker,
  defaultTrackerConfig,
  MAX_RECORDED_FRAMES,
  scaleRecordingSchema,
  track,
  type ScaleRecording,
} from '@macrofill/domain';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScaleTransport } from '@mlewand/huajun-ble-scale';
import {
  fromBase64,
  replayReadings,
  replaySession,
  SessionRecorder,
  toBase64,
  type ScaleReading,
} from '../src/index.js';
import { HuajunDriver } from '../src/huajun.js';
import { MockScaleDriver } from '../src/mock.js';
import { ReplayScaleDriver } from '../src/replay.js';
import { scaleScript } from '../src/script.js';

/** A capture from the real scale (see captures/README.md) as a recording, with no events yet. */
function capture(name: string, events: ScaleRecording['events'] = []): ScaleRecording {
  const lines = readFileSync(new URL(`captures/${name}.jsonl`, import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { t: number; hex: string });
  return {
    captureSessionId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
    driverId: 'huajun',
    trackerConfig: defaultTrackerConfig,
    frames: lines.map(({ t, hex }) => ({
      timestamp: t,
      receivedAt: 1_780_000_000_000 + t,
      raw: toBase64(Uint8Array.from(hex.split(' '), (b) => parseInt(b, 16))),
      // Deliberately wrong: replay must re-parse the bytes, not trust what was stored.
      reading: { grams: -1 },
    })),
    droppedFrames: 0,
    events,
  };
}

describe('SessionRecorder (M3-11)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('M3-11: records every frame (bytes, both receive times, parsed reading) and every user event', async () => {
    const driver = new MockScaleDriver({ now: () => Date.now() });
    const recorder = new SessionRecorder({
      captureSessionId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
      driverId: driver.id,
      trackerConfig: defaultTrackerConfig,
    });
    const stop = recorder.record(driver);
    await driver.connect();
    const start = Date.now();
    const played = driver.play(scaleScript().baseline(312, { forMs: 225 }).build());
    recorder.event({ type: 'start' }, start + 10);
    await vi.runAllTimersAsync();
    await played;
    recorder.event({ type: 'correct', grams: 20.5 }, start + 300);
    stop();
    void driver.play(scaleScript().baseline(1).build());
    await vi.runAllTimersAsync();

    const recording = recorder.recording();
    expect(scaleRecordingSchema.parse(recording)).toEqual(recording);
    expect(recording.driverId).toBe('mock');
    expect(recording.frames).toEqual([
      { timestamp: start, receivedAt: start, raw: '', reading: { grams: 312, stable: true } },
      {
        timestamp: start + 225,
        receivedAt: start + 225,
        raw: '',
        reading: { grams: 312, stable: true },
      },
    ]);
    expect(recording.events).toEqual([
      { type: 'start', at: start + 10, afterFrames: 1 },
      { type: 'correct', grams: 20.5, at: start + 300, afterFrames: 2 },
    ]);
  });

  it('M3-11: keeps the raw bytes, as base64', () => {
    const recorder = new SessionRecorder({
      captureSessionId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
      driverId: 'huajun',
      trackerConfig: defaultTrackerConfig,
    });
    const raw = new Uint8Array([0xac, 0x05, 0x00, 0x14, 0x89, 0x02, 0xca, 0xe7]);
    const reading: ScaleReading = { grams: 525.7, stable: true, timestamp: 5, receivedAt: 9, raw };
    recorder.frame(reading);
    const [frame] = recorder.recording().frames;
    expect(frame!.raw).toBe('rAUAFIkCyuc=');
    expect(fromBase64(frame!.raw)).toEqual(raw);
  });

  it('M3-11: past the size limit it counts the frames it drops, instead of failing the save (regression: #38)', () => {
    const recorder = new SessionRecorder({
      captureSessionId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
      driverId: 'mock',
      trackerConfig: defaultTrackerConfig,
      maxFrames: 3,
    });
    expect(recorder.recording().droppedFrames).toBe(0);
    for (let t = 0; t < 5; t++) {
      recorder.frame({ grams: 1, timestamp: t, receivedAt: t, raw: new Uint8Array(0) });
    }
    const recording = recorder.recording();
    expect(recording.frames.map((f) => f.timestamp)).toEqual([0, 1, 2]);
    // A replay of it is known to be incomplete.
    expect(recording.droppedFrames).toBe(2);
  });

  it("M3-11: a frame limit above the schema's is held to it, so the recording still saves (regression: #43)", () => {
    const recorder = new SessionRecorder({
      captureSessionId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
      driverId: 'mock',
      trackerConfig: defaultTrackerConfig,
      maxFrames: MAX_RECORDED_FRAMES + 5,
    });
    for (let t = 0; t < MAX_RECORDED_FRAMES + 1; t++) {
      recorder.frame({ grams: 1, timestamp: t, receivedAt: t, raw: new Uint8Array(0) });
    }
    const recording = recorder.recording();
    expect(recording.frames).toHaveLength(MAX_RECORDED_FRAMES);
    expect(recording.droppedFrames).toBe(1);
    expect(scaleRecordingSchema.safeParse(recording).success).toBe(true);
  });

  it('M3-11: records the frames the parser rejects too, with their receive times (regression: #38)', async () => {
    let clock = 100;
    const transport = new FakeTransport();
    const driver = new HuajunDriver({ transport: () => transport, monotonicNow: () => clock });
    const recorder = new SessionRecorder({
      captureSessionId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
      driverId: driver.id,
      trackerConfig: defaultTrackerConfig,
    });
    recorder.record(driver);
    await driver.connect();
    const bad = new Uint8Array([0xac, 0x05, 0x00]);
    const before = Date.now();
    transport.send(bad);
    clock = 325;
    transport.send(new Uint8Array([0xac, 0x05, 0x00, 0x14, 0x89, 0x02, 0xca, 0xe7]));
    const { frames } = recorder.recording();
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ timestamp: 100, raw: toBase64(bad), reading: {} });
    expect(frames[0]!.receivedAt).toBeGreaterThanOrEqual(before);
    expect(frames[1]).toMatchObject({ timestamp: 325, reading: { grams: 525.7 } });
    // Replay re-parses both: today's parser still rejects the first one.
    expect(replayReadings(recorder.recording()).map((r) => r.timestamp)).toEqual([325]);
  });
});

describe('replay (M3-11)', () => {
  it('M3-11: re-parses the stored bytes with the library, not the stored readings', () => {
    const recording = capture('test4');
    const readings = replayReadings(recording);
    expect(readings).toHaveLength(88);
    // Empty at the start, 525.6 g (or .7) settled at the end, per the capture notes.
    expect(readings[0]).toMatchObject({
      grams: 0,
      stable: true,
      timestamp: recording.frames[0]!.timestamp,
    });
    expect(readings.at(-1)!.grams).toBeCloseTo(525.6, 0);
    expect(readings.at(-1)!.receivedAt).toBe(1_780_000_000_000 + readings.at(-1)!.timestamp);
    expect(readings.every((r) => r.raw.length === 8)).toBe(true);
  });

  it('M3-11: replay uses the tracker settings the session was recorded with (regression: #38)', () => {
    // A step of -2 g: within this session's 5 g tolerance it's 0; with today's default, a correction.
    const frame = (timestamp: number, grams: number) => ({
      timestamp,
      receivedAt: timestamp,
      raw: '',
      reading: { grams, stable: true },
    });
    const recording: ScaleRecording = {
      captureSessionId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
      driverId: 'mock',
      trackerConfig: { ...defaultTrackerConfig, negativeToleranceGrams: 5 },
      frames: [frame(0, 312), frame(225, 310)],
      droppedFrames: 0,
      events: [
        { type: 'start', at: 100, afterFrames: 1 },
        { type: 'next', at: 300, afterFrames: 2 },
      ],
    };
    expect(replaySession(recording).steps).toEqual([
      { skipped: false, grams: 0, weightSource: 'scale', reading: 310 },
    ]);
    // A replay with other settings, e.g. to try a tuning, can say so.
    expect(replaySession(recording, defaultTrackerConfig).pending?.type).toBe('needsCorrection');
  });

  it('M3-11: replay keeps the order of events and frames that share a timestamp (regression: #38)', () => {
    // Start came before the 400 g reading, at the same quantized time: the baseline is 312.
    const recorder = new SessionRecorder({
      captureSessionId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
      driverId: 'mock',
      trackerConfig: defaultTrackerConfig,
    });
    const reading = (timestamp: number, grams: number): ScaleReading => ({
      grams,
      stable: true,
      timestamp,
      receivedAt: timestamp,
      raw: new Uint8Array(0),
    });
    recorder.frame(reading(0, 312));
    recorder.event({ type: 'start' }, 225);
    recorder.frame(reading(225, 400));
    expect(replaySession(recorder.recording()).baseline).toBe(312);
  });

  it('M3-11, M3-14: frames in another unit replay without grams', () => {
    const readings = replayReadings(capture('unit-cycle'));
    expect(readings.some((r) => r.grams === undefined)).toBe(true);
    expect(readings[0]!.grams).toBe(0);
  });

  it('M3-11: a frame the parser rejects is left out', () => {
    const recording = capture('test4');
    recording.frames[1] = { ...recording.frames[1]!, raw: toBase64(new Uint8Array([1, 2, 3])) };
    expect(replayReadings(recording)).toHaveLength(87);
  });

  it('M3-11: frames without bytes (from the mock) replay their stored reading', () => {
    const recording: ScaleRecording = {
      captureSessionId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
      driverId: 'mock',
      trackerConfig: defaultTrackerConfig,
      frames: [{ timestamp: 3, receivedAt: 4, raw: '', reading: { grams: 312, stable: true } }],
      droppedFrames: 0,
      events: [],
    };
    expect(replayReadings(recording)).toEqual([
      { grams: 312, stable: true, timestamp: 3, receivedAt: 4, raw: new Uint8Array(0) },
    ]);
  });

  it('M3-11: replaying a recording gives the same step amounts as the session it recorded', async () => {
    // Live: HuajunDriver gets the capture's bytes at their times; the tracker gets its readings and
    // the user's events as they happen; the recorder keeps both.
    const frames = capture('item-placed-and-lifted').frames;
    let clock = 0;
    const transport = new FakeTransport();
    const driver = new HuajunDriver({ transport: () => transport, monotonicNow: () => clock });
    const recorder = new SessionRecorder({
      captureSessionId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
      driverId: driver.id,
      trackerConfig: defaultTrackerConfig,
    });
    recorder.record(driver);
    let live = createTracker();
    driver.onReading((reading) => (live = track(live, { type: 'reading', reading })));
    await driver.connect();
    const user = (event: { type: 'start' | 'next' }) => {
      recorder.event(event, clock);
      live = track(live, event);
    };
    for (const frame of frames) {
      // Start on the empty scale; Next with the item on (about 24.8 g, placed after ~5 s); Next
      // again after it's lifted (between 6 and 7 s): a negative step, which asks for a correction.
      if (frame.timestamp > 2000 && live.baseline === undefined) user({ type: 'start' });
      if (frame.timestamp > 5800 && live.steps.length === 0 && !live.pending)
        user({ type: 'next' });
      if (frame.timestamp > 12_000 && live.steps.length === 1 && !live.pending)
        user({ type: 'next' });
      clock = frame.timestamp;
      transport.send(fromBase64(frame.raw));
    }
    expect(live.steps).toHaveLength(1);
    expect(live.steps[0]).toMatchObject({ skipped: false, weightSource: 'scale' });
    expect((live.steps[0] as { grams: number }).grams).toBeCloseTo(24.8, 0);
    expect(live.pending?.type).toBe('needsCorrection');

    const replayed = replaySession(recorder.recording());
    expect(replayed).toEqual(live);
  });
});

/** A BLE transport that the test feeds frames into. */
class FakeTransport implements ScaleTransport {
  #onData: ((data: Uint8Array) => void) | undefined;
  connect() {
    return Promise.resolve();
  }
  disconnect() {
    return Promise.resolve();
  }
  subscribe(_characteristic: string, onData: (data: Uint8Array) => void) {
    this.#onData = onData;
    return Promise.resolve();
  }
  onDisconnect() {}
  send(bytes: Uint8Array) {
    this.#onData?.(bytes);
  }
}

describe('ReplayScaleDriver (M3-11)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('M3-11: plays the re-parsed readings with their original timing and timestamps', async () => {
    const recording = capture('test4');
    const times = recording.frames.map((f) => f.timestamp);
    const driver = new ReplayScaleDriver(recording, { now: () => Date.now() });
    const got: { at: number; reading: ScaleReading }[] = [];
    const states: string[] = [];
    driver.onReading((reading) => got.push({ at: Date.now(), reading }));
    driver.onConnectionChange((s) => states.push(s));
    const start = Date.now();
    await driver.connect();
    expect(states).toEqual(['connected']);
    await vi.runAllTimersAsync();
    expect(got).toHaveLength(88);
    // First frame at once, then the gaps of the capture.
    expect(got.map((g) => g.at - start)).toEqual(times.map((t) => t - times[0]!));
    expect(got.map((g) => g.reading.timestamp)).toEqual(times);
    expect(driver.id).toBe('replay');
  });

  it('M3-11: plays faster when asked, with the timestamps unchanged', async () => {
    const recording = capture('test4');
    const times = recording.frames.map((f) => f.timestamp);
    const driver = new ReplayScaleDriver(recording, { speed: 10, now: () => Date.now() });
    const got: number[] = [];
    driver.onReading((r) => got.push(r.timestamp));
    const start = Date.now();
    await driver.connect();
    await vi.runAllTimersAsync();
    expect(got).toEqual(times);
    // Within the timers' 1 ms rounding.
    expect(Math.abs(Date.now() - start - (times.at(-1)! - times[0]!) / 10)).toBeLessThanOrEqual(1);
  });

  it('M3-11: stops on disconnect', async () => {
    const driver = new ReplayScaleDriver(capture('test4'), { now: () => Date.now() });
    const got: number[] = [];
    driver.onReading((r) => got.push(r.timestamp));
    await driver.connect();
    await vi.advanceTimersByTimeAsync(500);
    await driver.disconnect();
    await vi.runAllTimersAsync();
    expect(got).toHaveLength(3);
  });
});
