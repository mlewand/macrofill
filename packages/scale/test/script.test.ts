import { describe, expect, it } from 'vitest';
import { scaleScript } from '../src/index.js';

describe('scaleScript()', () => {
  it('M3-12: compiles to plain data: timed readings that survive JSON', () => {
    const readings = scaleScript()
      .baseline(312)
      .add(214, { overMs: 3000 })
      .stable()
      .add(18)
      .build();
    expect(JSON.parse(JSON.stringify(readings))).toEqual(readings);
    for (const r of readings)
      expect(Object.keys(r).sort()).toEqual(['grams', 'stable', 'timestamp']);
  });

  it('M3-12: readings come every 225 ms like the real scale, or at a set interval', () => {
    const times = (r: { timestamp: number }[]) => r.map((x) => x.timestamp);
    expect(times(scaleScript().baseline(0, { forMs: 450 }).build())).toEqual([0, 225, 450]);
    expect(times(scaleScript({ intervalMs: 100 }).baseline(0, { forMs: 200 }).build())).toEqual([
      0, 100, 200,
    ]);
  });

  it('M3-12: baseline and stable hold the weight flagged stable for 1000 ms by default', () => {
    const readings = scaleScript().baseline(312).build();
    expect(readings.every((r) => r.grams === 312 && r.stable === true)).toBe(true);
    expect(readings.at(-1)!.timestamp - readings[0]!.timestamp).toBeGreaterThanOrEqual(1000);
  });

  it('M3-12: add ramps to the new weight over overMs, unstable, in 0.1 g steps', () => {
    const readings = scaleScript().baseline(312, { forMs: 0 }).add(214, { overMs: 900 }).build();
    const ramp = readings.slice(1);
    expect(ramp.map((r) => r.grams)).toEqual([365.5, 419, 472.5, 526]);
    expect(ramp.every((r) => r.stable === false)).toBe(true);
    expect(ramp.at(-1)!.timestamp - readings[0]!.timestamp).toBe(900);
    expect(scaleScript().add(18.25).build()).toEqual([
      { timestamp: 0, grams: 18.3, stable: false },
    ]);
  });

  it('M3-12: remove, tare and unstable', () => {
    const readings = scaleScript()
      .baseline(526, { forMs: 0 })
      .remove(26)
      .tare()
      .unstable({ forMs: 225 })
      .build();
    expect(readings.map((r) => [r.grams, r.stable])).toEqual([
      [526, true],
      [500, false],
      [0, false],
      [0, false],
      [0, false],
    ]);
  });

  it('M3-12: without the stable flag, readings carry none, and stable holds long enough for the software rule', () => {
    const readings = scaleScript({ stableFlag: false }).baseline(312).add(10).build();
    expect(readings.every((r) => !('stable' in r))).toBe(true);
    const held = readings.filter((r) => r.grams === 312);
    expect(held.at(-1)!.timestamp - held[0]!.timestamp).toBeGreaterThanOrEqual(1000);
  });

  it('M3-12, M3-14: wrongUnit gives readings without grams, and the weight comes back after', () => {
    const readings = scaleScript()
      .baseline(312, { forMs: 0 })
      .wrongUnit({ forMs: 225 })
      .stable({ forMs: 0 })
      .build();
    expect(readings).toEqual([
      { timestamp: 0, grams: 312, stable: true },
      { timestamp: 225, stable: true },
      { timestamp: 450, stable: true },
      { timestamp: 675, grams: 312, stable: true },
    ]);
  });

  it('M3-12: take returns the readings since the last take, with weight and time running on', () => {
    const script = scaleScript().baseline(312, { forMs: 0 });
    expect(script.take()).toEqual([{ timestamp: 0, grams: 312, stable: true }]);
    script.add(214).stable({ forMs: 0 });
    expect(script.take()).toEqual([
      { timestamp: 225, grams: 526, stable: false },
      { timestamp: 450, grams: 526, stable: true },
    ]);
    expect(script.take()).toEqual([]);
    expect(script.build()).toHaveLength(3);
  });
});
