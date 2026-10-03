import { scaleScript, type ScaleDriver } from '@macrofill/scale';
import type { MockScaleDriver } from '@macrofill/scale/mock';
import { createContext, useContext, useState } from 'react';

/**
 * Creates the app's scale driver, once (see `ScaleHolder`). `main.tsx` provides it, and tests
 * provide `MockScaleDriver`, so the UI never imports a driver itself.
 */
export const ScaleContext = createContext<() => ScaleDriver>(() => {
  throw new Error('No scale driver: provide ScaleContext.');
});

export const useCreateScaleDriver = () => useContext(ScaleContext);

/**
 * The app's one scale driver, which outlives a meal (#89): the scale stays connected when a
 * Scale Mode session ends, so the next meal needn't pair it again. The driver is created on first
 * use, never in an effect (StrictMode runs those twice). The holder follows the connection
 * itself, because `ScaleDriver` has no current-state getter.
 */
export class ScaleHolder {
  readonly #create: () => ScaleDriver;
  #driver: ScaleDriver | undefined;
  #connected = false;

  constructor(create: () => ScaleDriver) {
    this.#create = create;
  }

  get driver(): ScaleDriver {
    if (this.#driver === undefined) {
      const driver = this.#create();
      driver.onConnectionChange((state) => {
        this.#connected = state === 'connected';
      });
      this.#driver = driver;
    }
    return this.#driver;
  }

  /** Whether the scale is connected right now. A drop between meals makes it false (#89-2). */
  get connected(): boolean {
    return this.#connected;
  }
}

/** `App` provides it, so every Scale Mode session shares the scale. */
export const ScaleHolderContext = createContext<ScaleHolder | undefined>(undefined);

/**
 * The app's `ScaleHolder`. A screen rendered without `App` (a test) holds a scale of its own.
 */
export function useScaleHolder(): ScaleHolder {
  const shared = useContext(ScaleHolderContext);
  const create = useCreateScaleDriver();
  const [own] = useState(() => new ScaleHolder(create));
  return shared ?? own;
}

/**
 * `localStorage` key that switches Scale Mode to `MockScaleDriver`: e2e tests set it before the
 * page loads (M6-8), and it serves for development without the scale.
 */
export const MOCK_SCALE_KEY = 'macrofill.mockScale';

/** The page's handles on the mock scale, for e2e tests and the browser console. */
export interface MockScaleWindow {
  /**
   * The connected session's mock scale: `macrofillScale.play(readings)`, `macrofillScale.drop()`.
   * Set on "Connect scale".
   */
  macrofillScale?: MockScaleDriver;
  /** `scaleScript()`, to build readings in the console. */
  macrofillScaleScript?: typeof scaleScript;
}

/**
 * The driver factory for `ScaleContext`: `real`, unless the mock scale is switched on. The mock is
 * loaded as its own chunk, so the production bundle that e2e tests is the one that ships (M1-5),
 * and normal use never downloads it.
 */
export async function scaleDriverFactory(real: () => ScaleDriver): Promise<() => ScaleDriver> {
  if (!mockScaleOn()) return real;
  const { MockScaleDriver } = await import('@macrofill/scale/mock');
  const handles = window as MockScaleWindow;
  handles.macrofillScaleScript = scaleScript;
  return () => {
    const driver = new MockScaleDriver();
    // Exposed once connected: in development, StrictMode creates a second driver that the session
    // discards, and only the kept one is ever connected.
    driver.onConnectionChange((state) => {
      if (state === 'connected') handles.macrofillScale = driver;
    });
    return driver;
  };
}

function mockScaleOn(): boolean {
  try {
    return localStorage.getItem(MOCK_SCALE_KEY) === '1';
  } catch {
    return false;
  }
}
