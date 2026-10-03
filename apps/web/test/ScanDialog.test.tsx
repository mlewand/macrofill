import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/en.json';
import { ScanDialog, type LookupOutcome } from '../src/products/ScanDialog';
import { ScannerContext } from '../src/scanner';
import { fakeScanner, type FakeScanner } from './support/scanner';

// Valid codes: an EAN-13, a UPC-A (stored padded to 13 digits) and an EAN-8.
const EAN13 = '5901234123457';
const UPC_A = '036000291452';

function setup(scanner: FakeScanner = fakeScanner(), lookupResult: LookupOutcome = 'found') {
  const lookup = vi.fn<(barcode: string) => Promise<LookupOutcome>>(() =>
    Promise.resolve(lookupResult),
  );
  const onCancel = vi.fn();
  const view = render(
    <ScannerContext value={scanner}>
      <ScanDialog lookup={lookup} onCancel={onCancel} />
    </ScannerContext>,
  );
  return { scanner, lookup, onCancel, view };
}

const read = (scanner: FakeScanner, code: string) => act(() => scanner.read(code));
const digits = () => screen.getByLabelText(en.scan.digits);
const typeDigits = (value: string) => fireEvent.change(digits(), { target: { value } });
const useDigits = () => fireEvent.click(screen.getByRole('button', { name: en.scan.useDigits }));
/** The camera is up once the scanner's start has been called and resolved. */
const cameraOpen = (scanner: FakeScanner) => waitFor(() => expect(scanner.open).toBe(true));

afterEach(() => cleanup());

describe('the scan view', () => {
  it('#65-6: asks for the camera when it opens, into a video that plays inline', async () => {
    const { scanner } = setup();
    await cameraOpen(scanner);
    expect(scanner.start).toHaveBeenCalledOnce();
    const video = scanner.start.mock.calls[0]![0];
    expect(video).toBeInstanceOf(HTMLVideoElement);
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute('playsinline');
    expect(screen.getByText(en.scan.hint)).toBeVisible();
  });

  it('#65-1, #65-2, #65-3: a code the camera reads closes the camera and is looked up as 13 digits', async () => {
    const { scanner, lookup } = setup();
    await cameraOpen(scanner);
    read(scanner, UPC_A);
    expect(scanner.open).toBe(false);
    await waitFor(() => expect(lookup).toHaveBeenCalledWith('0036000291452'));
    expect(lookup).toHaveBeenCalledOnce();
  });

  it('#65-1: a read with a wrong check digit, or not a barcode, is skipped and the camera stays on', async () => {
    const { scanner, lookup } = setup();
    await cameraOpen(scanner);
    read(scanner, '5901234123458');
    read(scanner, 'hello');
    read(scanner, '123');
    expect(scanner.open).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
    read(scanner, EAN13);
    await waitFor(() => expect(lookup).toHaveBeenCalledWith(EAN13));
  });

  it('a second read while the first is looked up does nothing', async () => {
    let finish!: (outcome: LookupOutcome) => void;
    const lookup = vi.fn(() => new Promise<LookupOutcome>((resolve) => (finish = resolve)));
    const scanner = fakeScanner();
    render(
      <ScannerContext value={scanner}>
        <ScanDialog lookup={lookup} onCancel={vi.fn()} />
      </ScannerContext>,
    );
    await cameraOpen(scanner);
    read(scanner, EAN13);
    expect(screen.getByText(en.scan.looking)).toBeVisible();
    read(scanner, UPC_A);
    expect(lookup).toHaveBeenCalledOnce();
    await act(async () => {
      finish('found');
      await Promise.resolve();
    });
  });
});

describe('typing the digits', () => {
  it('#65-1, #65-2: typed digits are looked up as 13 digits, spaces ignored', async () => {
    const { lookup } = setup(fakeScanner({ supported: false }));
    typeDigits('0360 0029 1452');
    useDigits();
    await waitFor(() => expect(lookup).toHaveBeenCalledWith('0036000291452'));
  });

  it('#65-1: a wrong length or check digit is refused with a message, and nothing is looked up', () => {
    const { lookup } = setup(fakeScanner({ supported: false }));
    typeDigits('12345');
    useDigits();
    expect(screen.getByText(en.scan.problem.format)).toBeVisible();
    typeDigits('5901234123458');
    useDigits();
    expect(screen.getByText(en.scan.problem.checkDigit)).toBeVisible();
    expect(digits()).toBeInvalid();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('works with the camera open too', async () => {
    const { scanner, lookup } = setup();
    await cameraOpen(scanner);
    typeDigits(EAN13);
    useDigits();
    await waitFor(() => expect(lookup).toHaveBeenCalledWith(EAN13));
    expect(scanner.open).toBe(false);
  });

  it('#65-7: submitting it never submits the form the view was opened from (the step)', async () => {
    const outer = vi.fn((event: React.FormEvent) => event.preventDefault());
    const lookup = vi.fn(() => Promise.resolve('found' as const));
    render(
      <ScannerContext value={fakeScanner({ supported: false })}>
        <form onSubmit={outer}>
          <ScanDialog lookup={lookup} onCancel={vi.fn()} />
        </form>
      </ScannerContext>,
    );
    typeDigits(EAN13);
    fireEvent.submit(digits());
    await waitFor(() => expect(lookup).toHaveBeenCalled());
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('no camera', () => {
  it('#65-1: a browser that cannot scan says so, never asks for the camera, and typing works', async () => {
    const { scanner, lookup } = setup(fakeScanner({ supported: false }));
    expect(await screen.findByText(en.scan.unsupported)).toBeVisible();
    expect(scanner.start).not.toHaveBeenCalled();
    typeDigits(EAN13);
    useDigits();
    await waitFor(() => expect(lookup).toHaveBeenCalledWith(EAN13));
  });

  it.each([
    ['denied', en.scan.denied],
    ['unavailable', en.scan.unavailable],
  ] as const)(
    '#65-6: a camera that is %s says so, and typing the digits still works',
    async (problem, text) => {
      const { lookup } = setup(fakeScanner({ problem }));
      expect(await screen.findByText(text)).toBeVisible();
      typeDigits(EAN13);
      useDigits();
      await waitFor(() => expect(lookup).toHaveBeenCalledWith(EAN13));
    },
  );
});

describe('the camera is always closed again', () => {
  it('Cancel closes it and leaves', async () => {
    const { scanner, onCancel } = setup();
    await cameraOpen(scanner);
    fireEvent.click(screen.getByRole('button', { name: en.scan.cancel }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('closing the view closes the camera', async () => {
    const { scanner, view } = setup();
    await cameraOpen(scanner);
    view.unmount();
    expect(scanner.stop).toHaveBeenCalledOnce();
  });

  it('a camera that opens after the view is gone is closed at once (a quick Cancel, or StrictMode)', async () => {
    let open!: () => void;
    const scanner = fakeScanner({ startAfter: new Promise<void>((resolve) => (open = resolve)) });
    const { view } = setup(scanner);
    await waitFor(() => expect(scanner.start).toHaveBeenCalled());
    view.unmount();
    expect(scanner.stop).not.toHaveBeenCalled();
    await act(async () => {
      open();
      await Promise.resolve();
    });
    expect(scanner.stop).toHaveBeenCalledOnce();
    expect(scanner.open).toBe(false);
  });
});

describe('a lookup that cannot be done (#65-3)', () => {
  it('says so, and Scan again opens the camera again', async () => {
    const { scanner, lookup } = setup(fakeScanner(), 'failed');
    await cameraOpen(scanner);
    read(scanner, EAN13);
    expect(await screen.findByText(en.scan.lookupFailed)).toBeVisible();
    expect(scanner.open).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: en.scan.scanAgain }));
    await cameraOpen(scanner);
    expect(scanner.start).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(en.scan.lookupFailed)).toBeNull();
    read(scanner, EAN13);
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
  });
});
