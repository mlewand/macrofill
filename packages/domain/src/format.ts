// M2-4: only the display rounds. Never feed these back into calculations.

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  // EPSILON so that halves like 12.35 (stored as 12.3499…) round up, as a reader expects.
  return Math.round((value + Number.EPSILON * Math.abs(value)) * factor) / factor;
}

/** Grams are displayed with 1 decimal. */
export function roundGrams(grams: number): number {
  return roundTo(grams, 1);
}

/** Kcal are displayed as an integer. */
export function roundKcal(kcal: number): number {
  return roundTo(kcal, 0);
}
