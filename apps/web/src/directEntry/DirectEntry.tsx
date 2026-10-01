import {
  mealNutrition,
  productPicker,
  type Catalog,
  type CatalogProduct,
  type NutritionValues,
  type Recipe,
  type SaveMealRequest,
} from '@macrofill/domain';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NutritionTable } from '../NutritionTable';
import { useSaveMeal, type SaveResult } from '../outbox/Outbox';
import { lastUser } from '../session';
import { useDraftStore, type Draft } from '../storage/drafts';
import {
  directEntry,
  isSummary,
  mealItems,
  saveRequest,
  startDirectEntry,
  stepProblem,
  type DirectEntryAction,
  type DirectEntryState,
} from './state';

interface Props {
  catalog: Catalog;
  onSaved: (result: SaveResult) => void;
  /** Leaving: from the recipe list, or discarding the meal. */
  onCancel: () => void;
  /** A session kept from before a reload (M5-8). */
  resume?: Draft;
}

/**
 * Direct Entry (M5-1 to M5-6): pick a recipe, enter each step, review and save. The session is
 * kept on the device from the recipe pick until it's saved or discarded (M5-8).
 */
export function DirectEntry({ catalog, onSaved, onCancel, resume }: Props) {
  const drafts = useDraftStore();
  // A session whose save was sent is resumed as it was: only resending that request is left.
  const [resumed] = useState(() =>
    resume?.sent ? resume.state : resume && resumable(resume.state, catalog),
  );
  const [state, setState] = useState<DirectEntryState | undefined>(resumed);
  const [sent, setSent] = useState(resumed && resume?.sent);
  const dispatch = (action: DirectEntryAction) =>
    setState((current) => (current ? directEntry(current, action) : current));

  useEffect(() => {
    // A kept session that no longer fits the catalog is dropped.
    if (resume && !resumed) void drafts.clear();
  }, [resume, resumed, drafts]);

  useEffect(() => {
    const username = lastUser();
    if (state) {
      void drafts.save({
        state,
        ...(sent ? { sent } : {}),
        ...(username === undefined ? {} : { username }),
      });
    }
  }, [state, sent, drafts]);

  const keepSent = async (request: SaveMealRequest) => {
    setSent(request);
    const username = lastUser();
    if (state) {
      await drafts.save({
        state,
        sent: request,
        ...(username === undefined ? {} : { username }),
      });
    }
  };
  const saved = (result: SaveResult) => void drafts.clear().then(() => onSaved(result));
  const discard = () => void drafts.clear().then(onCancel);

  if (state === undefined) {
    return (
      <RecipePicker
        recipes={catalog.recipes}
        onPick={(recipe) => setState(start(recipe, catalog))}
        onCancel={onCancel}
      />
    );
  }
  return isSummary(state) ? (
    <Summary
      state={state}
      catalog={catalog}
      dispatch={dispatch}
      onSaved={saved}
      onDiscard={discard}
      sent={sent}
      onSend={keepSent}
    />
  ) : (
    <StepScreen
      key={state.current}
      state={state}
      catalog={catalog}
      dispatch={dispatch}
      onDiscard={discard}
    />
  );
}

/**
 * A kept session, if it still fits the catalog: its recipe with the same steps, in the same order.
 * Products no longer in the catalog under the step's ingredient class are unpicked.
 */
function resumable(draft: DirectEntryState, catalog: Catalog): DirectEntryState | undefined {
  const recipe = catalog.recipes.find((r) => r.id === draft.recipe.id);
  const stepKey = (r: Recipe) => r.steps.map((s) => `${s.id}:${s.ingredientClassId}`).join();
  if (!recipe || stepKey(recipe) !== stepKey(draft.recipe)) return undefined;
  const classOf = new Map(catalog.products.map((p) => [p.id, p.ingredientClassId]));
  return {
    ...draft,
    recipe,
    steps: draft.steps.map((step, i) =>
      step.productId === undefined ||
      classOf.get(step.productId) === recipe.steps[i]!.ingredientClassId
        ? step
        : { ...step, productId: undefined },
    ),
  };
}

/** Discarding the meal in progress, after a confirmation. */
export function DiscardMeal({ onDiscard }: { onDiscard: () => void }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" className="secondary" onClick={() => setConfirming(true)}>
        {t('step.discard')}
      </button>
    );
  }
  return (
    <div className="confirm" role="group" aria-label={t('step.discardQuestion')}>
      <p>{t('step.discardQuestion')}</p>
      <div className="row">
        <button type="button" className="danger" onClick={onDiscard}>
          {t('step.confirmDiscard')}
        </button>
        <button type="button" className="secondary" onClick={() => setConfirming(false)}>
          {t('step.keep')}
        </button>
      </div>
    </div>
  );
}

/** Per step, the product the picker preselects (M5-2). Shared with Scale Mode. */
export function preselectedProducts(recipe: Recipe, catalog: Catalog): (string | undefined)[] {
  const lastUsed = lastUsedMap(catalog.products);
  return recipe.steps.map(
    (step) =>
      productPicker(productsOf(catalog, step.ingredientClassId), lastUsed, step.defaultProductId)
        .preselectedId,
  );
}

function start(recipe: Recipe, catalog: Catalog): DirectEntryState {
  return startDirectEntry({
    recipe,
    preselected: preselectedProducts(recipe, catalog),
    // Once per meal, never per save attempt: a retry must send the same ids (M4-6).
    mealId: crypto.randomUUID(),
    entryId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
  });
}

const productsOf = (catalog: Catalog, ingredientClassId: string) =>
  catalog.products.filter((p) => p.ingredientClassId === ingredientClassId);

function lastUsedMap(products: readonly CatalogProduct[]): Map<string, string> {
  return new Map(
    products.flatMap((p) => (p.lastUsedAt === null ? [] : [[p.id, p.lastUsedAt] as const])),
  );
}

export function RecipePicker(props: {
  recipes: Recipe[];
  onPick: (recipe: Recipe) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section>
      <h1>{t('recipes.title')}</h1>
      <ul className="choices">
        {props.recipes.map((recipe) => (
          <li key={recipe.id}>
            <button type="button" className="primary" onClick={() => props.onPick(recipe)}>
              {recipe.name.en}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="secondary" onClick={props.onCancel}>
        {t('recipes.cancel')}
      </button>
    </section>
  );
}

function StepScreen(props: {
  state: DirectEntryState;
  catalog: Catalog;
  dispatch: (action: DirectEntryAction) => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const { state, catalog, dispatch } = props;
  const gramsId = useId();
  const [attempted, setAttempted] = useState(false);
  const draft = state.steps[state.current]!;
  const problem = stepProblem(draft);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        dispatch({ type: 'next' });
      }}
    >
      <p className="progress">
        {t('step.progress', { current: state.current + 1, total: state.steps.length })}
      </p>
      <StepHeading state={state} catalog={catalog} />
      <ProductChoices
        state={state}
        catalog={catalog}
        onSelect={(productId) => dispatch({ type: 'selectProduct', productId })}
      />

      <label htmlFor={gramsId}>{t('step.grams')}</label>
      {/* Each step mounts anew, so the grams input is ready to type into (M5-3). */}
      <input
        id={gramsId}
        autoFocus
        className="grams"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={draft.grams}
        aria-invalid={attempted && problem !== undefined}
        onChange={(event) => dispatch({ type: 'setGrams', grams: event.target.value })}
      />
      {attempted && problem !== undefined && (
        <p role="alert" className="problem">
          {t(`step.problem.${problem}`)}
        </p>
      )}

      <button type="submit" className="primary">
        {t('step.next')}
      </button>
      <div className="row">
        <button type="button" className="secondary" onClick={() => dispatch({ type: 'skip' })}>
          {t('step.skip')}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={state.current === 0}
          onClick={() => dispatch({ type: 'undo' })}
        >
          {t('step.undo')}
        </button>
      </div>
      <DiscardMeal onDiscard={props.onDiscard} />
    </form>
  );
}

/** The current step's ingredient class, as the heading. */
export function StepHeading({ state, catalog }: { state: DirectEntryState; catalog: Catalog }) {
  const step = state.recipe.steps[state.current]!;
  const ingredientClass = catalog.ingredientClasses.find((c) => c.id === step.ingredientClassId);
  return <h1>{ingredientClass?.name.en ?? step.ingredientClassId}</h1>;
}

/** M5-2: products of the current step's class, most recently used first, then the default. */
export function ProductChoices(props: {
  state: DirectEntryState;
  catalog: Catalog;
  onSelect: (productId: string) => void;
}) {
  const { t } = useTranslation();
  const { state, catalog } = props;
  const step = state.recipe.steps[state.current]!;
  const draft = state.steps[state.current]!;
  const options = useMemo(
    () =>
      productPicker(
        productsOf(catalog, step.ingredientClassId),
        lastUsedMap(catalog.products),
        step.defaultProductId,
      ).options,
    [catalog, step],
  );
  return (
    <fieldset>
      <legend>{t('step.product')}</legend>
      {options.length === 0 && <p>{t('step.noProducts')}</p>}
      {options.map((product) => (
        <label key={product.id} className="option">
          <input
            type="radio"
            name="product"
            value={product.id}
            checked={draft.productId === product.id}
            onChange={() => props.onSelect(product.id)}
          />
          {product.name}
        </label>
      ))}
    </fieldset>
  );
}

export function Summary(props: {
  state: DirectEntryState;
  catalog: Catalog;
  dispatch: (action: DirectEntryAction) => void;
  /** Saved: the server has it, or it waits in the outbox (M5-9). */
  onSaved: (result: SaveResult) => void;
  /** Direct Entry only (M5-8). */
  onDiscard?: () => void;
  /** Direct Entry keeps the first request sent across a reload (M5-8); else the summary does. */
  sent?: SaveMealRequest | undefined;
  /** Resolves once the request is kept, so it's kept before it's sent. */
  onSend?: (request: SaveMealRequest) => Promise<void>;
}) {
  const { t } = useTranslation();
  const saveMeal = useSaveMeal();
  const { state, catalog, dispatch } = props;
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // The first request sent. It may have reached the server even if the response didn't come
  // back, so from then on the summary is frozen and every retry resends exactly this (M4-6).
  const [ownSent, setOwnSent] = useState<SaveMealRequest>();
  const sent = props.sent ?? ownSent;
  const setSent = async (request: SaveMealRequest) => {
    setOwnSent(request);
    await props.onSend?.(request);
  };
  const frozen = sent !== undefined;
  const products = useMemo(() => new Map(catalog.products.map((p) => [p.id, p])), [catalog]);

  const items = mealItems(state);
  const total = items && totalOf(items, catalog);

  // A second tap before the first save's re-render must not send again.
  const inFlight = useRef(false);
  const save = async () => {
    const body = sent ?? saveRequest(state, new Date().toISOString());
    if (!body || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setFailed(false);
    try {
      // Kept first: if the server stores it and the page goes away before the answer, a reload
      // still resends exactly this.
      await setSent(body);
      // How Today shows it while it waits to be sent (M5-9).
      const entry = {
        id: body.consumptionEntry.id,
        preparedMealId: body.meal.id,
        eatenAt: body.consumptionEntry.eatenAt,
        recipeName: state.recipe.name,
        nutrition: total ?? UNKNOWN_NUTRITION,
      };
      props.onSaved(await saveMeal(body, entry));
    } catch {
      inFlight.current = false;
      setFailed(true);
      setSaving(false);
    }
  };

  return (
    <section>
      <h1>{t('summary.title')}</h1>
      <ul className="items">
        {state.steps.map((draft, index) => {
          const step = state.recipe.steps[index]!;
          const name =
            (draft.productId && products.get(draft.productId)?.name) ??
            catalog.ingredientClasses.find((c) => c.id === step.ingredientClassId)?.name.en ??
            step.ingredientClassId;
          return (
            <li key={step.id}>
              {draft.skipped ? (
                <>
                  <span>{name}</span> <span className="muted">{t('summary.skipped')}</span>
                </>
              ) : (
                <SummaryItem
                  name={name}
                  grams={draft.grams}
                  invalid={stepProblem(draft) !== undefined}
                  disabled={frozen}
                  onChange={(grams) => dispatch({ type: 'editGrams', index, grams })}
                />
              )}
            </li>
          );
        })}
      </ul>

      <h2>{t('summary.total')}</h2>
      {total && <NutritionTable values={total} />}

      {failed && (
        <p role="alert" className="problem">
          {t('summary.saveFailed')}
        </p>
      )}
      <button
        type="button"
        className="primary"
        disabled={items === undefined || saving}
        onClick={() => void save()}
      >
        {saving ? t('summary.saving') : t('summary.save')}
      </button>
      <button
        type="button"
        className="secondary"
        disabled={frozen}
        onClick={() => dispatch({ type: 'undo' })}
      >
        {t('step.undo')}
      </button>
      {/* Not once a save was sent: the meal may be saved already. */}
      {props.onDiscard && !frozen && <DiscardMeal onDiscard={props.onDiscard} />}
    </section>
  );
}

/** Every value unknown (M2-3): a meal whose products are gone from the catalog. */
const UNKNOWN_NUTRITION: NutritionValues = {
  kcal: null,
  fat: null,
  saturates: null,
  carbs: null,
  sugars: null,
  protein: null,
  salt: null,
  fibre: null,
};

/** The meal's total, or undefined if a product is gone from the catalog (a resumed sent save). */
function totalOf(
  items: Parameters<typeof mealNutrition>[0],
  catalog: Catalog,
): NutritionValues | undefined {
  try {
    return mealNutrition(items, new Map(catalog.products.map((p) => [p.id, p.nutrition])));
  } catch {
    return undefined;
  }
}

function SummaryItem(props: {
  name: string;
  grams: string;
  invalid: boolean;
  disabled: boolean;
  onChange: (grams: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{props.name}</label>
      <input
        id={id}
        className="grams"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={t('summary.gramsFor', { product: props.name })}
        aria-invalid={props.invalid}
        disabled={props.disabled}
        value={props.grams}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </>
  );
}
