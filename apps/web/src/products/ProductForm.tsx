import {
  kcalMismatch,
  NUTRIENTS,
  type CatalogProduct,
  type IngredientClass,
  type Nutrient,
} from '@macrofill/domain';
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ApiError, useApi } from '../api/api';
import {
  emptyLabelForm,
  readLabelForm,
  type FieldProblem,
  type LabelFormValues,
} from './labelForm';

export interface ProductFormProps {
  ingredientClasses: readonly IngredientClass[];
  /** Preselected: the class of the step the product is added for. */
  ingredientClassId: string;
  /** Values to start from, e.g. a barcode lookup's result (#65, #66). */
  initial?: Partial<Omit<LabelFormValues, 'nutrition'>> & {
    nutrition?: Partial<Record<Nutrient, string>>;
  };
  /** The product is stored: it comes back as the shared store has it. */
  onSaved: (product: CatalogProduct) => void;
  onCancel: () => void;
}

/** What the server says for good about a request: not worth sending again as it is. */
const REFUSED = [400, 409, 413, 422];

const subscribeOnline = (listener: () => void) => {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
};

/** The browser's idea of being online. Guest Wi-Fi can still fail: a failed save says so too. */
function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}

/**
 * #64-1: adds a product by the values on its label. Saving needs a connection (#64-7) and is safe
 * to repeat: the id is made once, so a retry sends the same product (#64-8). Meant to be reused
 * prefilled by the barcode flows.
 */
export function ProductForm(props: ProductFormProps) {
  const { t } = useTranslation();
  const api = useApi();
  const online = useOnline();
  const ids = useId();
  const [id] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState<LabelFormValues>(() => {
    const empty = emptyLabelForm(props.ingredientClassId);
    return {
      ...empty,
      ...props.initial,
      nutrition: { ...empty.nutrition, ...props.initial?.nutrition },
    };
  });
  const [attempted, setAttempted] = useState(false);
  const [warning, setWarning] = useState<{ kcal: number; expected: number }>();
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<'failed' | 'refused'>();
  // A second tap before the first save's re-render must not send again.
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = readLabelForm(values);
  const shown = attempted && !read.ok ? read : undefined;

  // Any edit asks again about the energy: a confirmation is for the values it was given for.
  const edit = (change: (current: LabelFormValues) => LabelFormValues) => {
    setValues(change);
    setWarning(undefined);
  };

  const save = async (confirmed: boolean) => {
    if (inFlight.current || !online) return;
    setAttempted(true);
    if (!read.ok) return;
    const { nutrition } = read.product;
    const mismatch = kcalMismatch(nutrition);
    if (mismatch && !confirmed) {
      setWarning({ kcal: nutrition.kcal!, expected: mismatch.expected });
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setProblem(undefined);
    try {
      props.onSaved(await api.createProduct({ id, ...read.product }));
    } catch (error) {
      inFlight.current = false;
      if (!mounted.current) return;
      setProblem(
        error instanceof ApiError && REFUSED.includes(error.status) ? 'refused' : 'failed',
      );
      setSaving(false);
    }
  };

  const submit = (event: FormEvent) => {
    // Never the form around this one: in Direct Entry that is the step, which would move on.
    event.preventDefault();
    event.stopPropagation();
    void save(false);
  };

  const problemText = (problem: FieldProblem | undefined) =>
    problem === undefined ? undefined : t(`product.problem.${problem}`);

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor={`${ids}-name`}>{t('product.name')}</label>
      <input
        id={`${ids}-name`}
        autoFocus
        maxLength={200}
        autoComplete="off"
        value={values.name}
        aria-invalid={shown?.fields.name !== undefined}
        onChange={(event) => edit((v) => ({ ...v, name: event.target.value }))}
      />
      {shown?.fields.name && <p className="problem">{problemText(shown.fields.name)}</p>}

      <label htmlFor={`${ids}-brand`}>{t('product.brand')}</label>
      <input
        id={`${ids}-brand`}
        maxLength={200}
        autoComplete="off"
        value={values.brand}
        onChange={(event) => edit((v) => ({ ...v, brand: event.target.value }))}
      />

      <label htmlFor={`${ids}-class`}>{t('product.ingredientClass')}</label>
      <select
        id={`${ids}-class`}
        value={values.ingredientClassId}
        onChange={(event) => edit((v) => ({ ...v, ingredientClassId: event.target.value }))}
      >
        {props.ingredientClasses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name.en}
          </option>
        ))}
      </select>

      <fieldset>
        <legend>{t('product.per100')}</legend>
        {NUTRIENTS.map((nutrient) => (
          <div key={nutrient} className="value">
            <label htmlFor={`${ids}-${nutrient}`}>{t(`product.field.${nutrient}`)}</label>
            <input
              id={`${ids}-${nutrient}`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={values.nutrition[nutrient]}
              aria-invalid={shown?.fields[nutrient] !== undefined}
              onChange={(event) =>
                edit((v) => ({
                  ...v,
                  nutrition: { ...v.nutrition, [nutrient]: event.target.value },
                }))
              }
            />
            {shown?.fields[nutrient] && (
              <p className="problem">{problemText(shown.fields[nutrient])}</p>
            )}
          </div>
        ))}
      </fieldset>
      {shown?.total && (
        <p role="alert" className="problem">
          {t('product.problem.total')}
        </p>
      )}

      {warning && (
        <div role="alert" className="confirm">
          <p>
            {t('product.kcalWarning', {
              kcal: warning.kcal,
              expected: Math.round(warning.expected),
            })}
          </p>
          <div className="row">
            <button type="button" className="danger" onClick={() => void save(true)}>
              {t('product.saveAnyway')}
            </button>
            <button type="button" className="secondary" onClick={() => setWarning(undefined)}>
              {t('product.fixValues')}
            </button>
          </div>
        </div>
      )}
      {!online && <p role="status">{t('product.offline')}</p>}
      {problem && (
        <p role="alert" className="problem">
          {t(`product.${problem}`)}
        </p>
      )}

      {!warning && (
        <button type="submit" className="primary" disabled={saving || !online}>
          {saving ? t('product.saving') : t('product.save')}
        </button>
      )}
      {/* Not while saving: the request can't be taken back, so it's finished, not cancelled. */}
      <button type="button" className="secondary" disabled={saving} onClick={props.onCancel}>
        {t('product.cancel')}
      </button>
    </form>
  );
}

/**
 * The form over the screen it was opened from, which stays mounted underneath: a meal in progress
 * and, in Scale Mode, the scale connection and the wake lock go on while the form is open. It is
 * rendered outside the step's own form, so Enter or Save can't submit that one (#64-6).
 */
export function ProductDialog(props: ProductFormProps) {
  const { t } = useTranslation();
  const titleId = useId();
  return createPortal(
    <div className="overlay">
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="dialog">
        <h1 id={titleId}>{t('product.title')}</h1>
        <p className="muted">{t('product.intro')}</p>
        <ProductForm {...props} />
      </section>
    </div>,
    document.body,
  );
}
