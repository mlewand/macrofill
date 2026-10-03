import type { CatalogProduct, CreateProductRequest } from '@macrofill/domain';
import { NUTRIENTS } from '@macrofill/domain';
import type { Db } from '../db/client';
import type { Issue } from '../http/validation';
import { createRepositories } from '../repositories';

export type CreateProductResult =
  | { status: 'created' | 'replayed'; product: CatalogProduct }
  | { status: 'invalid'; issues: Issue[] }
  /** The id is taken by another product, or by the same one with other content. */
  | { status: 'conflict' };

/**
 * #64-4, #64-8: adds a product to the shared store. Idempotent through the client-generated id: a
 * retry of the same request returns the stored product and creates nothing.
 */
export async function createProduct(
  db: Db,
  userId: string,
  request: CreateProductRequest,
): Promise<CreateProductResult> {
  return db.transaction(async (tx) => {
    const repos = createRepositories(tx, userId);
    const replay = await existing(repos, request);
    if (replay) return replay;
    if (!(await repos.ingredientClasses.exists(request.ingredientClassId))) {
      return {
        status: 'invalid' as const,
        issues: [{ path: 'ingredientClassId', message: 'Unknown ingredient class.' }],
      };
    }
    if (!(await repos.products.insertIfAbsent(request))) {
      // Lost a race with a concurrent retry, or the id is someone else's.
      return (await existing(repos, request)) ?? { status: 'conflict' as const };
    }
    const product = await repos.products.find(request.id);
    if (!product) throw new Error('Added product not found.');
    return { status: 'created' as const, product: shown(product) };
  });
}

/** The stored product if the id is taken: a replay when it's this request, else a conflict. */
async function existing(
  repos: ReturnType<typeof createRepositories>,
  request: CreateProductRequest,
): Promise<CreateProductResult | undefined> {
  const stored = await repos.products.find(request.id);
  if (stored === undefined) return undefined;
  const same =
    stored.source === 'manual' &&
    stored.addedByUser &&
    stored.name === request.name &&
    stored.brand === request.brand &&
    stored.ingredientClassId === request.ingredientClassId &&
    NUTRIENTS.every((n) => stored.nutrition[n] === request.nutrition[n]);
  return same ? { status: 'replayed', product: shown(stored) } : { status: 'conflict' };
}

function shown({
  addedByUser: _addedByUser,
  ...product
}: CatalogProduct & { addedByUser: boolean }) {
  return product;
}
