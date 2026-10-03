import { parseBarcode } from '@macrofill/domain';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CameraError, useScanner, type CameraProblem } from '../scanner';

/** What the lookup of a barcode came to: a known product, none, or no way to ask. */
export type LookupOutcome = 'found' | 'unknown' | 'failed';

interface Props {
  /**
   * Looks the barcode up (13 digits, validated) and acts on the answer: on `found` or `unknown`
   * the caller closes this view, on `failed` it stays for another try.
   */
  lookup: (barcode: string) => Promise<LookupOutcome>;
  onCancel: () => void;
}

/**
 * #65-1: scans a barcode with the camera, or takes its digits typed in. Over the screen it was
 * opened from, which stays mounted (#65-7). The camera is asked for only here, and is closed when a
 * code is read, when the view closes and when it opens too late.
 */
export function ScanDialog({ lookup, onCancel }: Props) {
  const { t } = useTranslation();
  const scanner = useScanner();
  const titleId = useId();
  const digitsId = useId();
  const video = useRef<HTMLVideoElement>(null);
  // undefined until the browser has said whether it can scan.
  const [supported, setSupported] = useState<boolean>();
  const [camera, setCamera] = useState<CameraProblem>();
  const [scanning, setScanning] = useState(true);
  const [looking, setLooking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [typed, setTyped] = useState('');
  const [typedProblem, setTypedProblem] = useState<'format' | 'checkDigit'>();
  // One lookup at a time: the camera can read the same code many times before it's closed.
  const busy = useRef(false);
  const lookupRef = useRef(lookup);
  useEffect(() => {
    lookupRef.current = lookup;
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    void scanner.supported().then((yes) => current && setSupported(yes));
    return () => {
      current = false;
    };
  }, [scanner]);

  const find = async (barcode: string) => {
    if (busy.current) return;
    busy.current = true;
    setScanning(false);
    setFailed(false);
    setLooking(true);
    const outcome = await lookupRef.current(barcode).catch(() => 'failed' as const);
    busy.current = false;
    // On found or unknown the caller has moved on and this view is gone.
    if (!mounted.current) return;
    setLooking(false);
    if (outcome === 'failed') setFailed(true);
  };

  useEffect(() => {
    const element = video.current;
    if (!supported || !scanning || camera !== undefined || !element) return;
    let ended = false;
    let stop: (() => void) | undefined;
    scanner
      .start(element, (raw) => {
        const parsed = parseBarcode(raw);
        // A frame that isn't a valid code is skipped; the camera goes on.
        if (!ended && parsed.ok) void find(parsed.barcode);
      })
      .then(
        (close) => {
          // Opened after the view was gone, or after a code had been read: closed at once.
          if (ended) close();
          else stop = close;
        },
        (error: unknown) => {
          if (!ended) setCamera(error instanceof CameraError ? error.problem : 'unavailable');
        },
      );
    return () => {
      ended = true;
      stop?.();
    };
    // `find` only reads refs and setters.
  }, [scanner, supported, scanning, camera]);

  const submitDigits = (event: FormEvent) => {
    // Never the form around this one: in Direct Entry that is the step, which would move on.
    event.preventDefault();
    event.stopPropagation();
    const parsed = parseBarcode(typed);
    if (!parsed.ok) {
      setTypedProblem(parsed.reason);
      return;
    }
    setTypedProblem(undefined);
    void find(parsed.barcode);
  };

  const cameraProblem =
    supported === false ? 'unsupported' : camera !== undefined ? camera : undefined;
  const showCamera = supported === true && camera === undefined && scanning;

  return createPortal(
    <div className="overlay">
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="dialog">
        <h1 id={titleId}>{t('scan.title')}</h1>
        {showCamera && (
          <>
            <video ref={video} autoPlay muted playsInline className="camera" />
            <p className="muted">{t('scan.hint')}</p>
          </>
        )}
        {cameraProblem && <p className="muted">{t(`scan.${cameraProblem}`)}</p>}
        {looking && <p role="status">{t('scan.looking')}</p>}
        {failed && (
          <p role="alert" className="problem">
            {t('scan.lookupFailed')}
          </p>
        )}
        {failed && supported === true && camera === undefined && (
          <button
            type="button"
            className="primary"
            onClick={() => {
              setFailed(false);
              setScanning(true);
            }}
          >
            {t('scan.scanAgain')}
          </button>
        )}

        <form onSubmit={submitDigits} noValidate>
          <label htmlFor={digitsId}>{t('scan.digits')}</label>
          <input
            id={digitsId}
            inputMode="numeric"
            autoComplete="off"
            value={typed}
            aria-invalid={typedProblem !== undefined}
            onChange={(event) => {
              setTyped(event.target.value);
              setTypedProblem(undefined);
            }}
          />
          {typedProblem && <p className="problem">{t(`scan.problem.${typedProblem}`)}</p>}
          <button type="submit" className="secondary" disabled={looking}>
            {t('scan.useDigits')}
          </button>
        </form>
        <button type="button" className="secondary" onClick={onCancel}>
          {t('scan.cancel')}
        </button>
      </section>
    </div>,
    document.body,
  );
}
