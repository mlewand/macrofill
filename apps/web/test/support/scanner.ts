import { vi } from 'vitest';
import { CameraError, type BarcodeScanner, type CameraProblem } from '../../src/scanner';

/** A scanner for component tests: `read(code)` is what the camera sees while it's open. */
export interface FakeScanner extends BarcodeScanner {
  /** A code the open camera reads. Does nothing while the camera is closed. */
  read: (code: string) => void;
  /** Whether the camera is open now. */
  readonly open: boolean;
  start: ReturnType<typeof vi.fn<BarcodeScanner['start']>>;
  stop: ReturnType<typeof vi.fn<() => void>>;
}

export function fakeScanner(
  options: { supported?: boolean; problem?: CameraProblem; startAfter?: Promise<void> } = {},
): FakeScanner {
  let listener: ((raw: string) => void) | undefined;
  let open = false;
  const stop = vi.fn(() => {
    open = false;
    listener = undefined;
  });
  const start = vi.fn<BarcodeScanner['start']>(async (_video, onCode) => {
    await options.startAfter;
    if (options.problem) throw new CameraError(options.problem);
    open = true;
    listener = onCode;
    return stop;
  });
  return {
    supported: () => Promise.resolve(options.supported ?? true),
    start,
    stop,
    read: (code) => listener?.(code),
    get open() {
      return open;
    },
  };
}
