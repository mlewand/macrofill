import type { Catalog } from '@macrofill/domain';
import { Hono } from 'hono';
import type { Db } from '../db/client';
import type { AuthEnv } from '../http/auth';
import { createRepositories } from '../repositories';

export function catalogRoutes(db: Db) {
  return new Hono<AuthEnv>().get('/catalog', async (c) => {
    const repos = createRepositories(db, c.get('userId'));
    const [ingredientClasses, recipes, products] = await Promise.all([
      repos.ingredientClasses.all(),
      repos.recipes.all(),
      repos.products.visibleWithLastUse(),
    ]);
    return c.json({ ingredientClasses, recipes, products } satisfies Catalog);
  });
}
