import {
  currentAmount,
  parseGrams,
  type Catalog,
  type CatalogProduct,
  type Recipe,
  type TrackerConfig,
} from '@macrofill/domain';
import { SessionRecorder, type UserEvent } from '@macrofill/scale';
import { useCallback, useEffect, useId, useReducer, useRef, useState } from 'react';
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
import type { SaveResult } from '../outbox/Outbox';
import { useScaleHolder } from '../scale';
import { useTrack } from '../events/track';
import { sinceStart, useFlowEvents } from '../events/useFlowEvents';
import { reconnect } from './reconnect';
import { reconnectSettings, trackerSettings, type ReconnectSettings } from './settings';
import { belongsTo, lastUser } from '../session';
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
  /** A product was added at a step (#64): it joins the catalog the pickers list. */
  onProductAdded: (product: CatalogProduct) => void;
  onSaved: (result: SaveResult) => void;
  onCancel: () => void;
  /** Default: `trackerSettings`. */
  tracker?: Partial<TrackerConfig>;
  /** Default: `reconnectSettings`. */
  reconnect?: ReconnectSettings;
  /** Who's logged in as the session starts: the meal's owner (see Summary). */
  owner?: string | undefined;
}

/** Scale Mode (M6-1 to M6-5, M6-9, M6-10): pick a recipe, connect, Start, weigh each step, save. */
export function ScaleMode({
  catalog,
  onProductAdded,
  onSaved,
  onCancel,
  tracker = trackerSettings,
  reconnect = reconnectSettings,
  owner,
}: Props) {
  const [recipe, setRecipe] = useState<Recipe>();
  const track = useTrack();
  if (recipe === undefined) {
    return (
      <RecipePicker
        recipes={catalog.recipes}
        onPick={(picked) => {
          track('flow_started', { inputMethod: 'scale' });
          setRecipe(picked);
        }}
        onCancel={onCancel}
      />
    );
  }
  return (
    <Session
      recipe={recipe}
      catalog={catalog}
      onProductAdded={onProductAdded}
      tracker={tracker}
      reconnect={reconnect}
      onSaved={onSaved}
      owner={owner}
    />
  );
}

/**
 * `reconnecting`: the scale dropped mid-meal and the app reconnects (M6-6). `dropped`: that failed
 * or the user stopped it, so the meal goes on with typed grams.
 */
type Connection = 'idle' | 'connecting' | 'connected' | 'failed' | 'reconnecting' | 'dropped';

function Session(props: {
  recipe: Recipe;
  catalog: Catalog;
  onProductAdded: (product: CatalogProduct) => void;
  tracker: Partial<TrackerConfig>;
  reconnect: ReconnectSettings;
  onSaved: (result: SaveResult) => void;
  owner: string | undefined;
}) {
  const { t } = useTranslation();
  const { recipe, catalog } = props;
  // The app's scale, which outlives the session: still connected from the last meal if it hasn't
  // dropped since (#89).
  const holder = useScaleHolder();
  const driver = holder.driver;
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
  // M3-11, M6-7: every frame from the scale and every tap the tracker takes, saved with the meal.
  const [recorder] = useState(
    () =>
      new SessionRecorder({
        captureSessionId: state.flow.mealId,
        driverId: driver.id,
        trackerConfig: state.tracker.config,
      }),
  );
  const track = useTrack();
  // The state as last rendered: what the user saw when tapping.
  const shown = useRef(state);
  useEffect(() => {
    shown.current = state;
  });
  /**
   * A tap: recorded if it reaches the tracker, as it would in a replay. Taps the app's gates hold
   * back, or that go to the flow only (after finishing by hand), change nothing there.
   */
  const tap = (action: ScaleModeAction) => {
    const before = shown.current;
    const after = scaleMode(before, action);
    const event = trackerEvent(action);
    if (event && after.tracker !== before.tracker) recorder.event(event, performance.now());
    // M7-8: Undo on the first step goes back to before Start; the meal's step doesn't change, so
    // the flow's events miss it.
    if (before.tracker.baseline !== undefined && after.tracker.baseline === undefined) {
      track('step_undone', { inputMethod: 'scale', step: 0 });
    }
    dispatch(action);
  };
  const [connection, setConnection] = useState<Connection>(() =>
    holder.connected ? 'connected' : 'idle',
  );
  const [reconnectConfig] = useState(props.reconnect);
  const { startedAt } = state.flow;
  // The first step is shown from Start: connecting and the bowl don't count (M7-8).
  useFlowEvents(state.flow, state.tracker.baseline !== undefined);
  /** Saved: leaving the page now abandons nothing. */
  const finished = useRef(false);
  // A Scale Mode meal isn't kept across a reload: leaving the page abandons it (M7-8).
  useEffect(() => {
    const leaving = (event: PageTransitionEvent) => {
      // Kept in the back-forward cache, the page (and the meal) may come back.
      if (event.persisted || finished.current) return;
      finished.current = true;
      track('flow_abandoned', { inputMethod: 'scale', durationMs: sinceStart(startedAt) });
    };
    // In the capture phase: before App's own pagehide listener sends the last batch, so this
    // event is in it.
    window.addEventListener('pagehide', leaving, { capture: true });
    return () => window.removeEventListener('pagehide', leaving, { capture: true });
  }, [track, startedAt]);
  /** When the scale dropped, for how long reconnecting took (M7-8). */
  const droppedAt = useRef<number | undefined>(undefined);
  // Who the meal belongs to, fixed when the session starts (see Summary).
  const [owner] = useState(props.owner);
  const everConnected = useRef(holder.connected);
  /** The reconnect in progress (M6-6), to stop it. */
  const reconnecting = useRef<AbortController | undefined>(undefined);
  const byHand = useRef(false);

  useWakeLock(true);

  /** No more reconnecting: the rest of the meal takes typed grams (M6-5). */
  const finishByHand = useCallback(() => {
    byHand.current = true;
    reconnecting.current?.abort();
    reconnecting.current = undefined;
    setConnection('dropped');
    dispatch({ type: 'finishByHand' });
  }, []);

  // Subscribed before the reducer, so a tap counts the frame that came with it.
  useEffect(() => recorder.record(driver), [driver, recorder]);

  useEffect(() => {
    const offReading = driver.onReading((reading) => dispatch({ type: 'reading', reading }));
    const onChange = (change: 'connected' | 'disconnected') => {
      if (change === 'connected') {
        everConnected.current = true;
        // An attempt that was under way when the user chose typed grams: not needed any more.
        if (byHand.current) return void driver.disconnect().catch(() => undefined);
        if (droppedAt.current !== undefined) {
          const durationMs = Math.max(0, Math.round(performance.now() - droppedAt.current));
          droppedAt.current = undefined;
          track('scale_reconnected', { durationMs });
        }
        reconnecting.current = undefined;
        // Start and Next stay off until the first reading from this connection (see `stale`).
        setConnection('connected');
      } else if (everConnected.current && !byHand.current && !reconnecting.current) {
        // M6-6: keep the session and reconnect to the same device, without the chooser.
        const controller = new AbortController();
        reconnecting.current = controller;
        droppedAt.current = performance.now();
        track('scale_disconnected', {});
        setConnection('reconnecting');
        dispatch({ type: 'dropped' });
        void reconnect(() => driver.connect(), reconnectConfig, controller.signal).then(
          (result) => {
            if (result === 'gaveUp' && reconnecting.current === controller) finishByHand();
          },
        );
      }
    };
    const offConnection = driver.onConnectionChange(onChange);
    // A scale that dropped between this session's first render and now is a drop mid-meal (M6-6).
    if (everConnected.current && !holder.connected) onChange('disconnected');
    return () => {
      offReading();
      offConnection();
      reconnecting.current?.abort();
      reconnecting.current = undefined;
    };
  }, [driver, holder, reconnectConfig, finishByHand, track]);

  // The session ending doesn't disconnect the scale: the next meal uses it (#89-1). Reconnecting
  // stops with the session (above), and a drop after it is noticed by the next one (#89-3).

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
    // M6-1: announced when it changes. A live region rather than role="status", which the waiting
    // and proposal messages on the same screen already use.
    <p className="scale-status" aria-live="polite" aria-atomic="true">
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
            if (action.type === 'undo' || action.type === 'editGrams') tap(action);
          }}
          onSaved={(result) => {
            finished.current = true;
            track('flow_finished', {
              inputMethod: 'scale',
              durationMs: sinceStart(startedAt),
            });
            props.onSaved(result);
          }}
          recording={() => recorder.recording()}
          owner={owner}
          // Sent only for a known owner who's still logged in (another tab may have changed it).
          onSend={() => Promise.resolve(owner !== undefined && belongsTo(owner, lastUser()))}
        />
      </>
    );
  }

  // Until the first reading after a drop: a reconnected scale can still stay silent, and typed
  // grams must stay one tap away.
  const notice = (connection === 'reconnecting' || (state.stale && !state.manual)) && (
    <ReconnectNotice onFinish={finishByHand} />
  );

  // Before the first connection; after it, a drop reconnects by itself (M6-6).
  if (connection === 'idle' || connection === 'connecting' || connection === 'failed') {
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
        {notice}
        <h1>{recipe.name.en}</h1>
        <p>{t('scale.placeBowl')}</p>
        <Weights state={state} />
        <button
          type="button"
          className="primary"
          disabled={!canStart(state)}
          onClick={() => tap({ type: 'start' })}
        >
          {t('scale.start')}
        </button>
      </section>
    );
  }

  return (
    <StepScreen
      key={state.flow.current}
      state={state}
      catalog={catalog}
      dispatch={tap}
      onProductAdded={props.onProductAdded}
    >
      {status}
      {notice}
    </StepScreen>
  );
}

/** The tracker event of a tap, if it is one (M3-11). */
function trackerEvent(action: ScaleModeAction): UserEvent | undefined {
  switch (action.type) {
    case 'start':
    case 'next':
    case 'confirm':
    case 'skip':
    case 'undo':
      return { type: action.type };
    case 'correct': {
      const grams = parseGrams(action.grams);
      return grams.ok ? { type: 'correct', grams: grams.grams } : undefined;
    }
    default:
      return undefined;
  }
}

/** M6-6: the scale is reconnecting; the user can stop waiting and type the grams instead. */
function ReconnectNotice({ onFinish }: { onFinish: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="problem">{t('scale.reconnectingHint')}</p>
      <button type="button" className="secondary" onClick={onFinish}>
        {t('scale.finishByHand')}
      </button>
    </>
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
  onProductAdded: (product: CatalogProduct) => void;
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
        onSelect={(productId, otherClass) =>
          dispatch({
            type: 'selectProduct',
            productId,
            ...(otherClass ? { otherClass: true } : {}),
          })
        }
        onProductAdded={props.onProductAdded}
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
              // Focused when asked for; not for a negative step, where a keyboard would cover
              // the live weight.
              focus={typing}
              disabled={!canCorrect(state)}
              waiting={!state.wrongUnit && !canCorrect(state)}
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
function Correction(props: {
  focus: boolean;
  disabled: boolean;
  /** The scale hasn't settled: the grams can be used once it has. */
  waiting: boolean;
  onUse: (grams: string) => void;
}) {
  const { disabled, onUse } = props;
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
        autoFocus={props.focus}
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
      {props.waiting && <p className="muted">{t('scale.correctionNeedsStable')}</p>}
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
