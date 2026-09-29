import { describe, expect, it } from 'vitest';
import { parseGrams } from '../src/index.js';

describe('M5-3: grams input', () => {
  it.each([
    ['3,2', 3.2],
    ['3.2', 3.2],
    [' 3,2 ', 3.2],
    ['0', 0],
    ['212', 212],
    ['3,', 3],
    [',5', 0.5],
    ['.5', 0.5],
    // A comma is always the decimal separator, never a thousands separator.
    ['1,000', 1],
  ])('accepts %j as %d', (input, grams) => {
    expect(parseGrams(input)).toEqual({ ok: true, grams });
  });

  it.each(['', '   '])('rejects empty input %j', (input) => {
    expect(parseGrams(input)).toEqual({ ok: false, reason: 'empty' });
  });

  it.each(['-1', '-0,5', '- 3'])('rejects negative input %j', (input) => {
    expect(parseGrams(input)).toEqual({ ok: false, reason: 'negative' });
  });

  it('rejects a number too large to represent, instead of returning Infinity (regression: #13)', () => {
    expect(parseGrams('9'.repeat(400))).toEqual({ ok: false, reason: 'invalid' });
    expect(parseGrams(`${'9'.repeat(400)},5`)).toEqual({ ok: false, reason: 'invalid' });
  });

  it.each(['abc', '1.2.3', '1,2,3', '1e3', '0x10', 'Infinity', '3 2', ',', '.', '3g', '+3'])(
    'rejects non-numeric input %j',
    (input) => {
      expect(parseGrams(input)).toEqual({ ok: false, reason: 'invalid' });
    },
  );
});
