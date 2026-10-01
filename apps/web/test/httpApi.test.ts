import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpApi } from '../src/api/api';
import { createApiClient } from '../src/api/client';

describe('the http api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('M7-8: sending events gives up after a while, and still goes out as the page is left (regression: #52)', async () => {
    let init: RequestInit | undefined;
    // A request that never gets an answer.
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: unknown, given?: RequestInit) => {
        init = given;
        return new Promise<Response>(() => undefined);
      }),
    );
    const api = createHttpApi(createApiClient('http://localhost/api'));
    void api.sendEvents([]);
    await vi.waitFor(() => expect(init).toBeDefined());
    // Like saveMeal: it fails after a while, so the tracker's retry can run.
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    expect(init!.keepalive).toBe(true);
  });
});
