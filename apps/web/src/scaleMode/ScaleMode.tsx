import {
  currentAmount,
  parseGrams,
  type Catalog,
  type Recipe,
  type TrackerConfig,
} from '@macrofill/domain';
import type { ScaleDriver } from '@macrofill/scale';
import { useEffect, useId, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  preselectedProducts,
  ProductChoices,
  RecipePicker,
  StepHeading,
  Summary,
} from '../directEntry/DirectEntry';
import { isSummary, stepProblem } from '../directEntry/state';
import { formatGrams } from '../format';
import { useCreateScaleDriver } from '../scale';
import { trackerSettings } from './settings';
import {
  canCorrect,
  canNext,
  canStart,
  scaleMode,
  startScaleMode,
  type ScaleModeAction,
  type ScaleModeState,
} from './state';
import { useWakeLock } from './wakeLock';

interface Props {
  catalog: Catalog;
  onSaved: () => void;
  onCancel: () => void;
  /** Default: `trackerSettings`. */
  tracker?: Partial<TrackerConfig>;
}

/** Scale Mode (M6-1 to M6-5, M6-9, M6-10): pick a recipe, connect, Start, weigh each step, save. */
export function ScaleMode({ catalog, onSaved, onCancel, tracker = trackerSettings }: Props) {
  const [recipe, setRecipe] = useState<Recipe>();
  if (recipe === undefined) {
    return <RecipePicker recipes={catalog.recipes} onPick={setRecipe} onCancel={onCancel} />;
  }
  return <Session recipe={recipe} catalog={catalog} tracker={tracker} onSaved={onSaved} />;
}

type Connection = 'idle' | 'connecting' | 'connected' | 'failed' | 'dropped';

function Session(props: {
  recipe: Recipe;
  catalog: Catalog;
  tracker: Partial<TrackerConfig>;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { recipe, catalog } = props;
  const createDriver = useCreateScaleDriver();
  // One driver per session, created once: never in an effect, which StrictMode runs twice.
  const [driver] = useState<ScaleDriver>(createDriver);
  const [state, dispatch] = useReducer(scaleMode, undefined, () =>
    startScaleMode({
      recipe,
      preselected: preselectedProducts(recipe, catalog),
      // Once per meal, never per save attempt: a retry must send the same ids (M4-6).
      mealId: crypto.randomUUID(),
      entryId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      resolutionGrams: driver.capabilities.resolutionGrams,
      tracker: props.tracker,
    }),
  );
  const [connection, setConnection] = useState<Connection>('idle');
  const everConnected = useRef(false);

  useWakeLock(true);

  useEffect(() => {
    const offReading = driver.onReading((reading) => dispatch({ type: 'reading', reading }));
    const offConnection = driver.onConnectionChange((change) => {
      if (change === 'connected') {
        everConnected.current = true;
        setConnection('connected');
      } else if (everConnected.current) {
        // Phase B: no reconnect. The rest of the meal takes typed grams.
        setConnection('dropped');
        dispatch({ type: 'dropped' });
      }
    });
    return () => {
      offReading();
      offConnection();
    };
  }, [driver]);

  // Disconnect when the session ends (saved, cancelled or left). Safe before any connect.
  useEffect(() => () => void driver.disconnect().catch(() => undefined), [driver]);

  // M6-1: called straight from the click, so the device chooser gets the user gesture.
  const connect = () => {
    setConnection('connecting');
    driver.connect().then(
      () => {
        everConnected.current = true;
        setConnection('connected');
      },
      () => setConnection((current) => (current === 'connecting' ? 'failed' : current)),
    );
  };

  const status = (
    <p className="scale-status">
      {t(`scale.status.${connection === 'failed' ? 'idle' : connection}`)}
    </p>
  );

  if (isSummary(state.flow)) {
    return (
      <>
        {status}
        <Summary
          state={state.flow}
          catalog={catalog}
          dispatch={(action) => {
            if (action.type === 'undo' || action.type === 'editGrams') dispatch(action);
          }}
          onSaved={props.onSaved}
        />
      </>
    );
  }

  if (!state.manual && connection !== 'connected') {
    return (
      <section>
        {status}
        <h1>{recipe.name.en}</h1>
        <p>{t('scale.connectHint')}</p>
        {connection === 'failed' && (
          <p role="alert" className="problem">
            {t('scale.connectFailed')}
          </p>
        )}
        <button
          type="button"
          className="primary"
          disabled={connection === 'connecting'}
          onClick={connect}
        >
          {t('scale.connect')}
        </button>
      </section>
    );
  }

  if (!state.manual && state.tracker.baseline === undefined) {
    return (
      <section>
        {status}
        <h1>{recipe.name.en}</h1>
        <p>{t('scale.placeBowl')}</p>
        <Weights state={state} />
        <button
          type="button"
          className="primary"
          disabled={!canStart(state)}
          onClick={() => dispatch({ type: 'start' })}
        >
          {t('scale.start')}
        </button>
      </section>
    );
  }

  return (
    <StepScreen key={state.flow.current} state={state} catalog={catalog} dispatch={dispatch}>
      {status}
    </StepScreen>
  );
}

/** M6-3: the current step's amount in large digits, the scale's total smaller. */
function Weights({ state }: { state: ScaleModeState }) {
  const { t } = useTranslation();
  const amount = currentAmount(state.tracker);
  const total = state.tracker.latest?.grams;
  return (
    <>
      {state.wrongUnit && (
        <p role="alert" className="problem">
          {t('scale.wrongUnit')}
        </p>
      )}
      {amount !== undefined && (
        <p className="live-weight" aria-label={t('scale.added')}>
          {t('unit.grams', { value: formatGrams(amount) })}
        </p>
      )}
      {total !== undefined && (
        <p className="muted">{t('scale.total', { grams: formatGrams(total) })}</p>
      )}
    </>
  );
}

function StepScreen(props: {
  state: ScaleModeState;
  catalog: Catalog;
  dispatch: (action: ScaleModeAction) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { state, catalog, dispatch } = props;
  const flow = state.flow;
  const pending = state.tracker.pending;
  const [typing, setTyping] = useState(false);
  const previous = flow.current > 0 ? flow.steps[flow.current - 1] : undefined;
  const previousName =
    previous?.productId && catalog.products.find((p) => p.id === previous.productId)?.name;

  return (
    <section>
      {props.children}
      <p className="progress">
        {t('step.progress', { current: flow.current + 1, total: flow.steps.length })}
      </p>
      {/* M6-4: the value the last Next recorded. */}
      {previous && !previous.skipped && previousName && (
        <p className="muted">
          {t('scale.recorded', {
            product: previousName,
            grams: formatGrams(parseGramsOr0(previous.grams)),
          })}
        </p>
      )}
      <StepHeading state={flow} catalog={catalog} />
      <ProductChoices
        state={flow}
        catalog={catalog}
        onSelect={(productId) => dispatch({ type: 'selectProduct', productId })}
      />

      {state.manual ? (
        <ManualStep state={state} dispatch={dispatch} />
      ) : (
        <>
          <Weights state={state} />
          {pending?.type === 'waiting' && <p role="status">{t('scale.waiting')}</p>}
          {pending?.type === 'confirming' && (
            <p role="status">{t('scale.unstable', { grams: formatGrams(pending.amount) })}</p>
          )}
          {pending?.type === 'needsCorrection' && (
            <p role="alert" className="problem">
              {t('scale.negative')}
            </p>
          )}

          {pending?.type === 'confirming' ? (
            <button type="button" className="primary" onClick={() => dispatch({ type: 'confirm' })}>
              {t('scale.confirm')}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={!canNext(state)}
              onClick={() => dispatch({ type: 'next' })}
            >
              {pending === undefined ? t('step.next') : t('scale.readAgain')}
            </button>
          )}
          {pending?.type === 'confirming' && (
            <button
              type="button"
              className="secondary"
              disabled={!canNext(state)}
              onClick={() => dispatch({ type: 'next' })}
            >
              {t('scale.readAgain')}
            </button>
          )}

          {typing || pending?.type === 'needsCorrection' ? (
            <Correction
              disabled={!canCorrect(state)}
              onUse={(grams) => dispatch({ type: 'correct', grams })}
            />
          ) : (
            <button
              type="button"
              className="secondary"
              disabled={!canCorrect(state)}
              onClick={() => setTyping(true)}
            >
              {t('scale.enterManually')}
            </button>
          )}

          <div className="row">
            <button type="button" className="secondary" onClick={() => dispatch({ type: 'skip' })}>
              {t('step.skip')}
            </button>
            <button type="button" className="secondary" onClick={() => dispatch({ type: 'undo' })}>
              {t('step.undo')}
            </button>
          </div>
          <p className="muted">{t('scale.smallAmounts')}</p>
        </>
      )}
    </section>
  );
}

/** M6-5: typed grams for the current step, instead of the scale's. */
function Correction({ disabled, onUse }: { disabled: boolean; onUse: (grams: string) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [grams, setGrams] = useState('');
  const [attempted, setAttempted] = useState(false);
  const parsed = parseGrams(grams);
  return (
    <form
      className="correction"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (parsed.ok) onUse(grams);
      }}
    >
      <label htmlFor={id}>{t('step.grams')}</label>
      <input
        id={id}
        className="grams"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={grams}
        aria-invalid={attempted && !parsed.ok}
        onChange={(event) => setGrams(event.target.value)}
      />
      {attempted && !parsed.ok && (
        <p role="alert" className="problem">
          {t(`step.problem.${parsed.reason}`)}
        </p>
      )}
      <button type="submit" className="secondary" disabled={disabled}>
        {t('scale.useGrams')}
      </button>
    </form>
  );
}

/** After the scale dropped: the step takes typed grams, like Direct Entry. */
function ManualStep(props: { state: ScaleModeState; dispatch: (action: ScaleModeAction) => void }) {
  const { t } = useTranslation();
  const { state, dispatch } = props;
  const id = useId();
  const [attempted, setAttempted] = useState(false);
  const draft = state.flow.steps[state.flow.current]!;
  const problem = stepProblem(draft);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        dispatch({ type: 'next' });
      }}
    >
      <p role="alert" className="problem">
        {t('scale.dropped')}
      </p>
      <label htmlFor={id}>{t('step.grams')}</label>
      <input
        id={id}
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
        <button type="button" className="secondary" onClick={() => dispatch({ type: 'undo' })}>
          {t('step.undo')}
        </button>
      </div>
    </form>
  );
}

function parseGramsOr0(text: string): number {
  const parsed = parseGrams(text);
  return parsed.ok ? parsed.grams : 0;
}
