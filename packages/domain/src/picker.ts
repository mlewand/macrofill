export interface ProductPicker<T> {
  options: T[];
  preselectedId: string | undefined;
}

/**
 * M5-2: orders a step's products for the picker. Products the user has used come first, most
 * recent first; then the recipe's default product; then the rest by name. The most recently used
 * product is preselected; with no history, the default is.
 *
 * @param lastUsedAt product id → ISO UTC time of the user's last use
 */
export function productPicker<T extends { id: string; name: string }>(
  products: readonly T[],
  lastUsedAt: ReadonlyMap<string, string>,
  defaultProductId: string | undefined,
): ProductPicker<T> {
  const rank = (product: T) => {
    if (lastUsedAt.has(product.id)) return 0;
    return product.id === defaultProductId ? 1 : 2;
  };
  const options = [...products].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    // ISO UTC timestamps compare correctly as strings.
    const byUse = (lastUsedAt.get(b.id) ?? '').localeCompare(lastUsedAt.get(a.id) ?? '');
    return byUse !== 0 ? byUse : a.name.localeCompare(b.name);
  });
  const first = options[0];
  const preselected = first === undefined || rank(first) === 2 ? undefined : first.id;
  return { options, preselectedId: preselected };
}
