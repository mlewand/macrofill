import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserScanner, CameraError } from '../src/scanner';

// The browser's scanner against fake `BarcodeDetector` and camera APIs. Set on `navigator` with
// defineProperty, not by spreading it: a spread copy loses what lives on its prototype.

const defined: string[] = [];
function setNavigator(name: string, value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true });
  defined.push(name);
}

function fakeCamera() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const getUserMedia = vi.fn(() => Promise.resolve(stream));
  setNavigator('mediaDevices', { getUserMedia });
  return { track, stream, getUserMedia };
}

function fakeDetector(formats: string[], read: () => { rawValue: string }[] = () => []) {
  const detect = vi.fn(() => Promise.resolve(read()));
  class Detector {
    static getSupportedFormats = () => Promise.resolve(formats);
    detect = detect;
  }
  vi.stubGlobal('BarcodeDetector', Detector);
  return detect;
}

const video = () => {
  const element = document.createElement('video');
  element.play = vi.fn(() => Promise.resolve());
  return element;
};

afterEach(() => {
  for (const name of defined.splice(0))
    delete (navigator as unknown as Record<string, unknown>)[name];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('#65-1: the browser scanner', () => {
  it('is supported only with BarcodeDetector reading EAN-13, EAN-8 and UPC-A, and a camera API', async () => {
    fakeCamera();
    fakeDetector(['ean_13', 'ean_8', 'upc_a', 'qr_code']);
    expect(await browserScanner().supported()).toBe(true);
    // Present, but not reading this format on this device.
    fakeDetector(['qr_code', 'ean_8', 'upc_a']);
    expect(await browserScanner().supported()).toBe(false);
  });

  it('is not supported without BarcodeDetector, or without a camera API', async () => {
    fakeCamera();
    expect(await browserScanner().supported()).toBe(false);
    fakeDetector(['ean_13', 'ean_8', 'upc_a']);
    setNavigator('mediaDevices', undefined);
    expect(await browserScanner().supported()).toBe(false);
  });

  it('reads codes while open, and stop closes the camera for good', async () => {
    const { track, stream, getUserMedia } = fakeCamera();
    const detect = fakeDetector(['ean_13', 'ean_8', 'upc_a'], () => [
      { rawValue: '5901234123457' },
    ]);
    vi.useFakeTimers();
    const onCode = vi.fn();
    const element = video();
    const stop = await browserScanner().start(element, onCode);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(element.srcObject).toBe(stream);
    await vi.advanceTimersByTimeAsync(600);
    expect(onCode).toHaveBeenCalledWith('5901234123457');
    stop();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(element.srcObject).toBeNull();
    const reads = detect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(detect.mock.calls.length).toBe(reads);
  });

  it('a frame the detector fails on is skipped, and the next one is read', async () => {
    fakeCamera();
    let calls = 0;
    fakeDetector(['ean_13', 'ean_8', 'upc_a'], () => {
      if (++calls === 1) throw new Error('bad frame');
      return [{ rawValue: '96385074' }];
    });
    vi.useFakeTimers();
    const onCode = vi.fn();
    const stop = await browserScanner().start(video(), onCode);
    await vi.advanceTimersByTimeAsync(800);
    expect(onCode).toHaveBeenCalledWith('96385074');
    stop();
  });

  it('#65-6: a refused camera is denied; no camera, or one that fails to open, is unavailable', async () => {
    fakeDetector(['ean_13', 'ean_8', 'upc_a']);
    for (const [error, problem] of [
      ['NotAllowedError', 'denied'],
      ['NotFoundError', 'unavailable'],
      ['NotReadableError', 'unavailable'],
    ] as const) {
      setNavigator('mediaDevices', {
        getUserMedia: () => Promise.reject(new DOMException('x', error)),
      });
      await expect(browserScanner().start(video(), vi.fn())).rejects.toEqual(
        new CameraError(problem),
      );
    }
  });

  it('#65-6: a camera permission already denied is not asked for again', async () => {
    const { getUserMedia } = fakeCamera();
    fakeDetector(['ean_13', 'ean_8', 'upc_a']);
    setNavigator('permissions', { query: () => Promise.resolve({ state: 'denied' }) });
    await expect(browserScanner().start(video(), vi.fn())).rejects.toEqual(
      new CameraError('denied'),
    );
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
