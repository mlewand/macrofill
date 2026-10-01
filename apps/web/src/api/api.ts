import {
  catalogSchema,
  saveMealResponseSchema,
  todaySchema,
  type Catalog,
  type SaveMealRequest,
  type SaveMealResponse,
  type Today,
} from '@macrofill/domain';
import { createContext, useContext } from 'react';
import { createApiClient, type ApiClient } from './client';

/** What the UI needs from the api. Components get it from context, so tests can pass a fake. */
export interface Api {
  /** M4-1: sets the session cookie. `invalid` for a wrong username or password. */
  login: (username: string, password: string) => Promise<'ok' | 'invalid'>;
  catalog: () => Promise<Catalog>;
  /** Resolves once the server has the meal (201 created, or 200 for a retry of a saved meal). */
  saveMeal: (request: SaveMealRequest) => Promise<SaveMealResponse>;
  /** Today's entries, totals and targets, in the user's timezone (M7-1 to M7-3). */
  today: () => Promise<Today>;
  /** Deletes a consumption entry (M7-4). Resolves also when it's already gone. */
  deleteEntry: (id: string) => Promise<void>;
}

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
    async catalog() {
      const res = await client.catalog.$get();
      if (!res.ok) throw new ApiError(res.status);
      return catalogSchema.parse(await res.json());
    },
    async saveMeal(request) {
      const res = await client.meals.$post({ json: request });
      if (res.status !== 200 && res.status !== 201) throw new ApiError(res.status);
      return saveMealResponseSchema.parse(await res.json());
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
    catalog: guard(api.catalog),
    saveMeal: guard(api.saveMeal),
    today: guard(api.today),
    deleteEntry: guard(api.deleteEntry),
  };
}

export const ApiContext = createContext<Api | undefined>(undefined);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (api === undefined) throw new Error('useApi needs an ApiContext provider');
  return api;
}
