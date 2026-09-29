// M2-4: only the display rounds. Never feed these back into calculations.

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const magnitude = Math.abs(value);
  // Halves round away from zero, so a negative "remaining" mirrors a positive one. EPSILON makes
  // halves like 12.35 (stored as 12.3499…) round as a reader expects.
  const rounded =
    (Math.sign(value) * Math.round((magnitude + Number.EPSILON * magnitude) * factor)) / factor;
  // Never -0, which Intl would show as "-0".
  return rounded === 0 ? 0 : rounded;
}

/** Grams are displayed with 1 decimal. */
export function roundGrams(grams: number): number {
  return roundTo(grams, 1);
}

/** Kcal are displayed as an integer. */
export function roundKcal(kcal: number): number {
  return roundTo(kcal, 0);
}
