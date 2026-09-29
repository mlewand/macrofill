import { describe, expect, it } from 'vitest';
import { roundGrams, roundKcal } from '../src/index.js';

describe('M2-4: display rounding', () => {
  it.each([
    [12.34, 12.3],
    [12.35, 12.4],
    [0.04, 0],
    [99.95, 100],
  ])('grams %d display as %d', (grams, shown) => {
    expect(roundGrams(grams)).toBe(shown);
  });

  it.each([
    [118.5, 119],
    [118.49, 118],
    [0.4, 0],
  ])('kcal %d display as %d', (kcal, shown) => {
    expect(roundKcal(kcal)).toBe(shown);
  });

  it.each([
    [-0.4, 0],
    [-118.5, -119],
    [-118.49, -118],
  ])('kcal %d display as %d, never -0, halves away from zero', (kcal, shown) => {
    expect(Object.is(roundKcal(kcal), shown)).toBe(true);
  });

  it.each([
    [-0.04, 0],
    [-12.35, -12.4],
  ])('grams %d display as %d, never -0, halves away from zero', (grams, shown) => {
    expect(Object.is(roundGrams(grams), shown)).toBe(true);
  });
});
