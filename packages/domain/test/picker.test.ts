import { describe, expect, it } from 'vitest';
import { productPicker } from '../src/index.js';

const p = (id: string, name: string) => ({ id, name });
const products = [p('a', 'Zott'), p('b', 'Almette'), p('c', 'Mlekovita'), p('d', 'Bieluch')];

describe('M5-2: product picker', () => {
  it('with no history, preselects the default and lists it first, then the rest by name', () => {
    const picker = productPicker(products, new Map(), 'c');
    expect(picker.options.map((o) => o.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(picker.preselectedId).toBe('c');
  });

  it("sorts by the user's most recent use, and preselects the most recent", () => {
    const lastUsed = new Map([
      ['a', '2026-01-10T08:00:00.000Z'],
      ['d', '2026-01-12T08:00:00.000Z'],
    ]);
    const picker = productPicker(products, lastUsed, 'c');
    expect(picker.options.map((o) => o.id)).toEqual(['d', 'a', 'c', 'b']);
    expect(picker.preselectedId).toBe('d');
  });

  it('with no history and no default, preselects nothing', () => {
    const picker = productPicker(products, new Map(), undefined);
    expect(picker.options.map((o) => o.id)).toEqual(['b', 'd', 'c', 'a']);
    expect(picker.preselectedId).toBeUndefined();
  });

  it('ignores a default that is not among the products', () => {
    expect(productPicker(products, new Map(), 'x').preselectedId).toBeUndefined();
  });

  it('breaks equal use times by name, so the order is stable', () => {
    const at = '2026-01-10T08:00:00.000Z';
    const picker = productPicker(
      products,
      new Map([
        ['a', at],
        ['b', at],
      ]),
      undefined,
    );
    expect(picker.options.map((o) => o.id).slice(0, 2)).toEqual(['b', 'a']);
  });
});
