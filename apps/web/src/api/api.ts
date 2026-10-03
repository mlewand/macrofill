import {
  catalogProductSchema,
  catalogSchema,
  meSchema,
  saveMealResponseSchema,
  todaySchema,
  type Catalog,
  type CatalogProduct,
  type CreateProductRequest,
  type SaveMealRequest,
  type SaveMealResponse,
  type Today,
  type UsageEvent,
} from '@macrofill/domain';
import { createContext, useContext } from 'react';
import { createApiClient, type ApiClient } from './client';

/** What the UI needs from the api. Components get it from context, so tests can pass a fake. */
export interface Api {
  /** M4-1: sets the session cookie. `invalid` for a wrong username or password. */
  login: (username: string, password: string) => Promise<'ok' | 'invalid'>;
  /** Who the session belongs to (M4-1). */
  me: () => Promise<string>;
  catalog: () => Promise<Catalog>;
  /** Resolves once the server has the meal (201 created, or 200 for a retry of a saved meal). */
  saveMeal: (request: SaveMealRequest) => Promise<SaveMealResponse>;
  /** Today's entries, totals and targets, in the user's timezone (M7-1 to M7-3). */
  today: () => Promise<Today>;
  /**
   * #64-4, #64-8: adds a product to the shared store. Resolves with the stored product, also for
   * a retry of the same request (same id). Rejects with an `ApiError` the server refused, and with
   * any other error when it can't be reached.
   */
  createProduct: (request: CreateProductRequest) => Promise<CatalogProduct>;
  /** Deletes a consumption entry (M7-4). Resolves also when it's already gone. */
  deleteEntry: (id: string) => Promise<void>;
  /** M7-8, M4-10: a batch of usage events. Resolves once the server has them. */
  sendEvents: (events: UsageEvent[]) => Promise<void>;
}

/** How long a save request may take before it counts as unanswered. */
const SAVE_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`api responded ${status}`);
  }
}

export function createHttpApi(client: ApiClient = createApiClient()): Api {
  return {
    async login(username, password) {
      const res = await client.login.$post({ json: { username, password } });
      if (res.status === 204) return 'ok';
      if (res.status === 401) return 'invalid';
      throw new ApiError(res.status);
    },
    async me() {
      const res = await client.me.$get();
      if (!res.ok) throw new ApiError(res.status);
      return meSchema.parse(await res.json()).username;
    },
    async catalog() {
      const res = await client.catalog.$get();
      if (!res.ok) throw new ApiError(res.status);
      return catalogSchema.parse(await res.json());
    },
    async saveMeal(request) {
      // A request that never gets an answer fails after a while, so a sync can go on later.
      const res = await client.meals.$post(
        { json: request },
        { init: { signal: AbortSignal.timeout(SAVE_TIMEOUT_MS) } },
      );
      if (res.status !== 200 && res.status !== 201) throw new ApiError(res.status);
      return saveMealResponseSchema.parse(await res.json());
    },
    async createProduct(request) {
      const res = await client.products.$post(
        { json: request },
        { init: { signal: AbortSignal.timeout(SAVE_TIMEOUT_MS) } },
      );
      if (res.status !== 200 && res.status !== 201) throw new ApiError(res.status);
      return catalogProductSchema.parse(await res.json());
    },
    async today() {
      const res = await client.today.$get();
      if (!res.ok) throw new ApiError(res.status);
      return todaySchema.parse(await res.json());
    },
    async deleteEntry(id) {
      const res = await client['consumption-entries'][':id'].$delete({ param: { id } });
      if (res.status !== 204 && res.status !== 404) throw new ApiError(res.status);
    },
    async sendEvents(events) {
      // keepalive: it still goes out when the page is being left. And like a save, it fails after
      // a while without an answer, so the tracker can send again.
      const res = await client.events.$post(
        { json: { events } },
        { init: { keepalive: true, signal: AbortSignal.timeout(SAVE_TIMEOUT_MS) } },
      );
      if (res.status !== 204) throw new ApiError(res.status);
    },
  };
}

/**
 * M4-2: `api`, calling `onUnauthorized` whenever a request is refused for want of a session. The
 * request still fails as before; the caller's own retry works once logged in again.
 */
export function guardApi(api: Api, onUnauthorized: () => void): Api {
  const guard =
    <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await call(...args);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) onUnauthorized();
        throw error;
      }
    };
  return {
    login: api.login,
    me: api.me,
    catalog: guard(api.catalog),
    saveMeal: guard(api.saveMeal),
    createProduct: guard(api.createProduct),
    today: guard(api.today),
    deleteEntry: guard(api.deleteEntry),
    // Not guarded: tracking never asks to log in. Events wait for a session (M7-8).
    sendEvents: api.sendEvents,
  };
}

export const ApiContext = createContext<Api | undefined>(undefined);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (api === undefined) throw new Error('useApi needs an ApiContext provider');
  return api;
}
