import type { ScaleDriver } from '@macrofill/scale';
import { createContext, useContext } from 'react';

/**
 * Creates the scale driver for a Scale Mode session. `main.tsx` provides the real one, and tests
 * provide `MockScaleDriver`, so the UI never imports a driver itself.
 */
export const ScaleContext = createContext<() => ScaleDriver>(() => {
  throw new Error('No scale driver: provide ScaleContext.');
});

export const useCreateScaleDriver = () => useContext(ScaleContext);
