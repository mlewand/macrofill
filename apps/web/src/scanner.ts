import { createContext, useContext } from 'react';

// The barcode scanner seam (#65). The UI never touches the camera or `BarcodeDetector` itself: it
// uses a `BarcodeScanner` from context, so tests provide a fake and e2e a mock, as with the scale.

/** Why the camera can't be used: the user refused it, or there is none or it can't be opened. */
export type CameraProblem = 'denied' | 'unavailable';

export class CameraError extends Error {
  constructor(readonly problem: CameraProblem) {
    super(`camera ${problem}`);
  }
}

export interface BarcodeScanner {
  /** Whether this browser can read EAN-13, EAN-8 and UPC-A from the camera. */
  supported: () => Promise<boolean>;
  /**
   * Opens the camera into `video` and calls `onCode` with every code it reads, as the detector
   * gives it (the app validates it). Resolves with the function that closes the camera. Rejects with
   * a `CameraError`. The camera is only asked for here, so permission is requested on the first
   * scan and not before (#65-6).
   */
  start: (video: HTMLVideoElement, onCode: (raw: string) => void) => Promise<() => void>;
}

export const ScannerContext = createContext<BarcodeScanner>(browserScanner());

export const useScanner = () => useContext(ScannerContext);

/**
 * `localStorage` key that switches the scanner to a mock: e2e tests set it before the page loads
 * (Playwright has no camera), and it serves development on a machine without one.
 */
export const MOCK_SCANNER_KEY = 'macrofill.mockScanner';

/** The page's handle on the mock scanner, for e2e tests and the browser console. */
export interface MockScannerWindow {
  /** `macrofillScanner.scan('5901234123457')`: the camera "reads" this code, if it's open. */
  macrofillScanner?: { scan: (code: string) => void };
}

/**
 * The scanner for `ScannerContext`: the browser's, unless the mock is switched on. The mock is its
 * own chunk, so the production bundle that e2e tests is the one that ships (M1-5).
 */
export async function scannerFactory(): Promise<BarcodeScanner> {
  if (!mockScannerOn()) return browserScanner();
  const { createMockScanner } = await import('./scannerMock');
  return createMockScanner(window as MockScannerWindow);
}

function mockScannerOn(): boolean {
  try {
    return localStorage.getItem(MOCK_SCANNER_KEY) === '1';
  } catch {
    return false;
  }
}

// `BarcodeDetector` (Shape Detection API) is in Android Chrome; TypeScript's DOM types lack it.
interface Detector {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
}
interface DetectorConstructor {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats: () => Promise<string[]>;
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a'];
/** How often a frame is looked at: often enough to feel instant, rarely enough to stay cool. */
const SCAN_INTERVAL_MS = 250;

function detectorClass(): DetectorConstructor | undefined {
  return (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
}

/** The camera and `BarcodeDetector` of the browser. */
export function browserScanner(): BarcodeScanner {
  return {
    async supported() {
      const Detector = detectorClass();
      if (!Detector || !navigator.mediaDevices?.getUserMedia) return false;
      try {
        // Present in the browser doesn't mean it reads these formats on this device.
        const formats = await Detector.getSupportedFormats();
        return FORMATS.every((format) => formats.includes(format));
      } catch {
        return false;
      }
    },

    async start(video, onCode) {
      const Detector = detectorClass();
      if (!Detector || !navigator.mediaDevices?.getUserMedia) throw new CameraError('unavailable');
      // Already refused: no need to try, and nothing is asked again.
      try {
        const status = await navigator.permissions?.query({ name: 'camera' });
        if (status?.state === 'denied') throw new CameraError('denied');
      } catch (error) {
        if (error instanceof CameraError) throw error;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : '';
        throw new CameraError(
          name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable',
        );
      }
      const stop = () => {
        clearInterval(timer);
        for (const track of stream.getTracks()) track.stop();
        video.srcObject = null;
      };
      video.srcObject = stream;
      const detector = new Detector({ formats: FORMATS });
      let busy = false;
      const timer = setInterval(() => {
        if (busy) return;
        busy = true;
        Promise.resolve()
          .then(() => detector.detect(video))
          .then((codes) => codes.forEach((code) => onCode(code.rawValue)))
          // A frame that can't be read is skipped; the next one may be fine.
          .catch(() => undefined)
          .finally(() => {
            busy = false;
          });
      }, SCAN_INTERVAL_MS);
      void video.play().catch(() => undefined);
      return stop;
    },
  };
}
