export type GramsInput =
  { ok: true; grams: number } | { ok: false; reason: 'empty' | 'negative' | 'invalid' };

/**
 * M5-3: parses a grams input. Accepts `3,2` and `3.2`: a comma is always the decimal separator,
 * never a thousands separator. Rejects empty, non-numeric and negative values. Stricter than
 * `Number()`, which reads `''` as 0 and accepts `1e3`, `0x10` and `Infinity`.
 */
export function parseGrams(input: string): GramsInput {
  const text = input.trim();
  if (text === '') return { ok: false, reason: 'empty' };
  if (/^-\s*(\d+[.,]?\d*|[.,]\d+)$/.test(text)) return { ok: false, reason: 'negative' };
  if (!/^(\d+[.,]?\d*|[.,]\d+)$/.test(text)) return { ok: false, reason: 'invalid' };
  return { ok: true, grams: Number(text.replace(',', '.')) };
}
