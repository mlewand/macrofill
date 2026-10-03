import {
  createProductRequestSchema,
  NUTRIENTS,
  parseLabelValue,
  partOfWholeProblems,
  type CreateProductRequest,
  type Nutrient,
  type ProductCandidate,
  type NutritionValues,
} from '@macrofill/domain';

/** The product form as typed: every value is text, as in the inputs (#64-1). */
export interface LabelFormValues {
  name: string;
  brand: string;
  ingredientClassId: string;
  nutrition: Record<Nutrient, string>;
}

export type FieldProblem =
  'name' | 'negative' | 'invalid' | 'tooLarge' | 'tooLong' | 'aboveCarbs' | 'aboveFat';

/** The longest name or brand the shared store takes; the inputs say it too. */
export const MAX_TEXT = 200;

export type LabelFormResult =
  | { ok: true; product: Omit<CreateProductRequest, 'id'> }
  | {
      ok: false;
      fields: Partial<Record<'name' | 'brand' | Nutrient, FieldProblem>>;
      /** The values are fine one by one, but add up to more than 100 g per 100 g. */
      total?: true;
    };

export function emptyLabelForm(ingredientClassId: string): LabelFormValues {
  return {
    name: '',
    brand: '',
    ingredientClassId,
    nutrition: Object.fromEntries(NUTRIENTS.map((n) => [n, ''])) as Record<Nutrient, string>,
  };
}

/** #64-1, #64-2: the typed values as a product to add, or what's wrong with them. */
export function readLabelForm(values: LabelFormValues): LabelFormResult {
  const fields: Partial<Record<'name' | 'brand' | Nutrient, FieldProblem>> = {};
  const name = values.name.trim();
  if (name === '') fields.name = 'name';
  else if (name.length > MAX_TEXT) fields.name = 'tooLong';
  if (values.brand.trim().length > MAX_TEXT) fields.brand = 'tooLong';
  const nutrition = {} as { -readonly [N in Nutrient]: number | null };
  for (const nutrient of NUTRIENTS) {
    const parsed = parseLabelValue(nutrient, values.nutrition[nutrient]);
    if (parsed.ok) nutrition[nutrient] = parsed.value;
    else fields[nutrient] = parsed.reason;
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  // #69-1: a part above its whole is named on the part's field. Only once every value is a number:
  // there's nothing to compare with a malformed one.
  for (const part of partOfWholeProblems(nutrition)) {
    fields[part] = part === 'sugars' ? 'aboveCarbs' : 'aboveFat';
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };

  const brand = values.brand.trim();
  const product = {
    ingredientClassId: values.ingredientClassId,
    name,
    ...(brand === '' ? {} : { brand }),
    nutrition: nutrition satisfies NutritionValues,
  };
  // The sums are the server's rules too; the shared schema says whether they hold.
  const checked = createProductRequestSchema.safeParse({ id: crypto.randomUUID(), ...product });
  if (!checked.success) return { ok: false, fields: {}, total: true };
  return { ok: true, product };
}

/**
 * A provider's candidate as the form's starting values (#66-2). A value the provider lacks is an
 * empty field: unknown, never 0 (M2-3). The ingredient class is not the candidate's to give.
 */
export function candidateToForm(candidate: ProductCandidate): {
  name: string;
  brand: string;
  nutrition: Record<Nutrient, string>;
} {
  return {
    // Cut to what can be saved: the inputs' maxLength doesn't touch values set from code.
    name: candidate.name.slice(0, MAX_TEXT),
    brand: (candidate.brand ?? '').slice(0, MAX_TEXT),
    nutrition: Object.fromEntries(
      NUTRIENTS.map((n) => [
        n,
        candidate.nutrition[n] === null ? '' : String(candidate.nutrition[n]),
      ]),
    ) as Record<Nutrient, string>,
  };
}
