import { describe, expect, it } from 'vitest';
import { emptyLabelForm, readLabelForm, type LabelFormValues } from '../src/products/labelForm';

const filled = (change: Partial<LabelFormValues['nutrition']> = {}): LabelFormValues => ({
  ...emptyLabelForm('curd'),
  name: 'Homemade curd',
  nutrition: { ...emptyLabelForm('curd').nutrition, kcal: '119', protein: '17', ...change },
});

describe('#64-1: reading the product form', () => {
  it('starts empty, with the step’s ingredient class', () => {
    const form = emptyLabelForm('milk');
    expect(form.ingredientClassId).toBe('milk');
    expect(form.name).toBe('');
    expect(Object.values(form.nutrition).every((v) => v === '')).toBe(true);
  });

  it('turns the typed values into a product, with empty values unknown', () => {
    const result = readLabelForm({ ...filled({ fat: '4,2', carbs: '3.4' }), brand: ' Home ' });
    expect(result).toEqual({
      ok: true,
      product: {
        ingredientClassId: 'curd',
        name: 'Homemade curd',
        brand: 'Home',
        nutrition: {
          kcal: 119,
          fat: 4.2,
          saturates: null,
          carbs: 3.4,
          sugars: null,
          protein: 17,
          salt: null,
          fibre: null,
        },
      },
    });
  });

  it('leaves the brand out when it is blank, and a product may have no values at all', () => {
    const result = readLabelForm({ ...emptyLabelForm('curd'), name: 'Mystery', brand: '  ' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.product).not.toHaveProperty('brand');
      expect(Object.values(result.product.nutrition).every((v) => v === null)).toBe(true);
    }
  });

  it('needs a name', () => {
    expect(readLabelForm({ ...filled(), name: '  ' })).toEqual({
      ok: false,
      fields: { name: 'name' },
    });
  });
});

describe('#64-2: the form rejects what the label cannot say', () => {
  it('names the field with a negative, malformed or too large value', () => {
    expect(readLabelForm(filled({ fat: '-1', sugars: 'abc', salt: '100,5' }))).toEqual({
      ok: false,
      fields: { fat: 'negative', sugars: 'invalid', salt: 'tooLarge' },
    });
  });

  it('accepts large kcal', () => {
    expect(readLabelForm(filled({ kcal: '884' })).ok).toBe(true);
  });

  it('rejects carbs + protein + fat above 100 g, naming no single field', () => {
    expect(readLabelForm(filled({ carbs: '50', protein: '30', fat: '21' }))).toEqual({
      ok: false,
      fields: {},
      total: true,
    });
  });

  it('rejects the M2-6 sum with fibre and salt too', () => {
    expect(
      readLabelForm(filled({ carbs: '50', protein: '30', fat: '19', fibre: '1', salt: '1' })),
    ).toEqual({
      ok: false,
      fields: {},
      total: true,
    });
  });
});
