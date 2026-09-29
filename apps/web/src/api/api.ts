import {
  catalogSchema,
  saveMealResponseSchema,
  type Catalog,
  type SaveMealRequest,
  type SaveMealResponse,
} from '@macrofill/domain';
import { createContext, useContext } from 'react';
import { createApiClient, type ApiClient } from './client';

/** What the UI needs from the api. Components get it from context, so tests can pass a fake. */
export interface Api {
  catalog: () => Promise<Catalog>;
  /** Resolves once the server has the meal (201 created, or 200 for a retry of a saved meal). */
  saveMeal: (request: SaveMealRequest) => Promise<SaveMealResponse>;
}

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`api responded ${status}`);
  }
}

export function createHttpApi(client: ApiClient = createApiClient()): Api {
  return {
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
  };
}

export const ApiContext = createContext<Api | undefined>(undefined);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (api === undefined) throw new Error('useApi needs an ApiContext provider');
  return api;
}
