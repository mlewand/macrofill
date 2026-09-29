import { roundGrams, roundKcal } from '@macrofill/domain';

// M2-4: only the display rounds, grams to 1 decimal and kcal to an integer.
const grams = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const kcal = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

export const formatGrams = (value: number) => grams.format(roundGrams(value));
export const formatKcal = (value: number) => kcal.format(roundKcal(value));
