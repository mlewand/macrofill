import type { TimedReading } from '@macrofill/domain';

export interface ScaleScriptOptions {
  /** ms between readings. Default 225, like the real scale. */
  intervalMs?: number;
  /** Whether readings carry the scale's stable flag. Default true. */
  stableFlag?: boolean;
  /** The weight before the first step. Default 0. */
  grams?: number;
}

interface Hold {
  /** How long the weight is held, in ms. Default 1000. */
  forMs?: number;
}

/**
 * M3-12: describes scale behaviour fluently, e.g.
 * `scaleScript().baseline(312).add(214, { overMs: 3000 }).stable().add(18)`, and compiles it to
 * plain data: timed readings, starting at 0 ms, for the tracker in unit tests and for
 * `MockScaleDriver` in e2e.
 */
export function scaleScript(options: ScaleScriptOptions = {}) {
  return new ScaleScript(options);
}

export class ScaleScript {
  readonly #intervalMs: number;
  readonly #stableFlag: boolean;
  #grams: number;
  #time = 0;
  #readings: TimedReading[] = [];
  #taken = 0;

  constructor(options: ScaleScriptOptions) {
    this.#intervalMs = options.intervalMs ?? 225;
    this.#stableFlag = options.stableFlag ?? true;
    this.#grams = options.grams ?? 0;
  }

  /** The bowl or plate on the scale, settled. */
  baseline(grams: number, hold: Hold = {}): this {
    this.#grams = grams;
    return this.stable(hold);
  }

  /** Holds the weight, flagged stable. Long enough for the software rule by default (M3-5). */
  stable(hold: Hold = {}): this {
    return this.#hold(hold, true, true);
  }

  /** Holds the weight, flagged unstable (e.g. a spoon resting on the bowl). */
  unstable(hold: Hold = {}): this {
    return this.#hold(hold, false, true);
  }

  /** Adds grams, unstable, in even steps over `overMs` (one reading when 0, the default). */
  add(grams: number, { overMs = 0 }: { overMs?: number } = {}): this {
    const from = this.#grams;
    const steps = Math.max(1, Math.ceil(overMs / this.#intervalMs));
    for (let i = 1; i <= steps; i++) this.#push(round(from + (grams * i) / steps), false);
    this.#grams = round(from + grams);
    return this;
  }

  remove(grams: number, options: { overMs?: number } = {}): this {
    return this.add(-grams, options);
  }

  /** The scale re-zeroes with everything still on it. */
  tare(): this {
    this.#grams = 0;
    this.#push(0, false);
    return this;
  }

  /** M3-14: the scale shows another unit, so readings have no grams. The weight is kept. */
  wrongUnit(hold: Hold = {}): this {
    return this.#hold(hold, true, false);
  }

  /** All readings so far. */
  build(): TimedReading[] {
    return this.#readings.map((r) => ({ ...r }));
  }

  /** The readings added since the last `take()`, so a test can play a meal step by step. */
  take(): TimedReading[] {
    const taken = this.#readings.slice(this.#taken).map((r) => ({ ...r }));
    this.#taken = this.#readings.length;
    return taken;
  }

  #hold({ forMs = 1000 }: Hold, stable: boolean, withGrams: boolean): this {
    // Readings at both ends, so the hold spans at least forMs.
    const count = Math.ceil(forMs / this.#intervalMs) + 1;
    for (let i = 0; i < count; i++) this.#push(withGrams ? this.#grams : undefined, stable);
    return this;
  }

  #push(grams: number | undefined, stable: boolean) {
    const reading: TimedReading = { timestamp: this.#time };
    if (grams !== undefined) reading.grams = grams;
    if (this.#stableFlag) reading.stable = stable;
    this.#readings.push(reading);
    this.#time += this.#intervalMs;
  }
}

/** To the scale's 0.1 g resolution, without float noise. */
const round = (grams: number) => Math.round(grams * 10) / 10;
