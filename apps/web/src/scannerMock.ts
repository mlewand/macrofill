import type { BarcodeScanner, MockScannerWindow } from './scanner';

/**
 * The scanner e2e tests use: no camera, and the page's `macrofillScanner.scan(code)` stands in for
 * a code the camera reads while the scan view is open.
 */
export function createMockScanner(handles: MockScannerWindow): BarcodeScanner {
  let listener: ((raw: string) => void) | undefined;
  handles.macrofillScanner = { scan: (code) => listener?.(code) };
  return {
    supported: () => Promise.resolve(true),
    start: (_video, onCode) => {
      listener = onCode;
      return Promise.resolve(() => {
        if (listener === onCode) listener = undefined;
      });
    },
  };
}
