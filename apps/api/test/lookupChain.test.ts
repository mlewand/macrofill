import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductLookupProvider, ProviderResult } from '../src/lookup/provider';
import { lookupBarcode } from '../src/services/lookup';

const candidate = (source: string) => ({
  source,
  sourceRef: 'ref',
  name: `From ${source}`,
  nutrition: {
    kcal: null,
    fat: null,
    saturates: null,
    carbs: null,
    sugars: null,
    protein: null,
    salt: null,
    fibre: null,
  },
});

const provider = (id: string, result: ProviderResult | (() => Promise<ProviderResult>)) => {
  const lookup = vi.fn<ProductLookupProvider['lookup']>(() =>
    typeof result === 'function' ? result() : Promise.resolve(result),
  );
  return { id, lookup } satisfies ProductLookupProvider;
};
const hit = (id: string): ProviderResult => ({ result: 'hit', candidate: candidate(id) });

const BARCODE = '3017620422003';

afterEach(() => vi.useRealTimers());

describe('the lookup chain (#67-1, #67-2, #67-4)', () => {
  it('#67-1: asks the providers in order, and the first hit wins: the later ones are not asked', async () => {
    const off = provider('openfoodfacts', hit('openfoodfacts'));
    const usda = provider('usda-fdc', hit('usda-fdc'));
    const answer = await lookupBarcode([off, usda], BARCODE);
    expect(answer.candidate?.source).toBe('openfoodfacts');
    expect(answer.attempts).toEqual([{ provider: 'openfoodfacts', result: 'hit' }]);
    expect(off.lookup).toHaveBeenCalledOnce();
    expect(usda.lookup).not.toHaveBeenCalled();
  });

  it.each(['miss', 'error', 'timeout'] as const)(
    '#67-2, #67-4: a provider that gives %s passes to the next, and both are recorded',
    async (first) => {
      const off = provider('openfoodfacts', { result: first });
      const usda = provider('usda-fdc', hit('usda-fdc'));
      const answer = await lookupBarcode([off, usda], BARCODE);
      expect(answer.candidate?.source).toBe('usda-fdc');
      expect(answer.attempts).toEqual([
        { provider: 'openfoodfacts', result: first },
        { provider: 'usda-fdc', result: 'hit' },
      ]);
      expect(usda.lookup).toHaveBeenCalledWith(BARCODE, expect.anything());
    },
  );

  it('#67-4: a miss on every provider is recorded for each, with no candidate', async () => {
    const answer = await lookupBarcode(
      [provider('openfoodfacts', { result: 'miss' }), provider('usda-fdc', { result: 'miss' })],
      BARCODE,
    );
    expect(answer).toEqual({
      attempts: [
        { provider: 'openfoodfacts', result: 'miss' },
        { provider: 'usda-fdc', result: 'miss' },
      ],
    });
  });

  it('#67-2: a provider that throws, against its contract, is an error and the chain goes on', async () => {
    const broken = provider('openfoodfacts', () => Promise.reject(new Error('boom')));
    const usda = provider('usda-fdc', hit('usda-fdc'));
    const answer = await lookupBarcode([broken, usda], BARCODE);
    expect(answer.attempts[0]).toEqual({ provider: 'openfoodfacts', result: 'error' });
    expect(answer.candidate?.source).toBe('usda-fdc');
  });

  it('#67-2: when the whole lookup runs out of time, the provider being asked is told to stop and the rest are not asked', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    // A provider that waits for the signal, as the real ones do, and reports a timeout.
    const slow = provider('openfoodfacts', () => {
      return new Promise<ProviderResult>((resolve) => {
        signal?.addEventListener('abort', () => resolve({ result: 'timeout' }));
      });
    });
    slow.lookup.mockImplementation((_barcode, options) => {
      signal = options?.signal;
      return new Promise<ProviderResult>((resolve) => {
        signal?.addEventListener('abort', () => resolve({ result: 'timeout' }));
      });
    });
    const usda = provider('usda-fdc', hit('usda-fdc'));
    const pending = lookupBarcode([slow, usda], BARCODE, { totalTimeoutMs: 10_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    const answer = await pending;
    expect(signal?.aborted).toBe(true);
    expect(answer).toEqual({ attempts: [{ provider: 'openfoodfacts', result: 'timeout' }] });
    expect(usda.lookup).not.toHaveBeenCalled();
  });

  it('#67-2: a provider that gives up on its own time leaves the rest of the total for the next one', async () => {
    vi.useFakeTimers();
    const off = provider(
      'openfoodfacts',
      () => new Promise((resolve) => setTimeout(() => resolve({ result: 'timeout' }), 5000)),
    );
    const usda = provider('usda-fdc', hit('usda-fdc'));
    const pending = lookupBarcode([off, usda], BARCODE, { totalTimeoutMs: 10_000 });
    await vi.advanceTimersByTimeAsync(5000);
    const answer = await pending;
    expect(answer.candidate?.source).toBe('usda-fdc');
    expect(answer.attempts).toEqual([
      { provider: 'openfoodfacts', result: 'timeout' },
      { provider: 'usda-fdc', result: 'hit' },
    ]);
  });

  it('with no providers there is nothing to ask', async () => {
    expect(await lookupBarcode([], BARCODE)).toEqual({ attempts: [] });
  });
});
