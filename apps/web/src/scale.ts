import { scaleScript, type ScaleDriver } from '@macrofill/scale';
import type { MockScaleDriver } from '@macrofill/scale/mock';
import { createContext, useContext } from 'react';

/**
 * Creates the scale driver for a Scale Mode session. `main.tsx` provides it, and tests provide
 * `MockScaleDriver`, so the UI never imports a driver itself.
 */
export const ScaleContext = createContext<() => ScaleDriver>(() => {
  throw new Error('No scale driver: provide ScaleContext.');
});

export const useCreateScaleDriver = () => useContext(ScaleContext);

/**
 * `localStorage` key that switches Scale Mode to `MockScaleDriver`: e2e tests set it before the
 * page loads (M6-8), and it serves for development without the scale.
 */
export const MOCK_SCALE_KEY = 'macrofill.mockScale';

/** The page's handles on the mock scale, for e2e tests and the browser console. */
export interface MockScaleWindow {
  /** The current session's mock scale: `macrofillScale.play(readings)`, `macrofillScale.drop()`. */
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
    handles.macrofillScale = driver;
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
