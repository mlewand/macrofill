import type { Catalog } from '@macrofill/domain';
import { replaySession, scaleScript } from '@macrofill/scale';
import { MockScaleDriver } from '@macrofill/scale/mock';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiContext, type Api } from '../src/api/api';
import { App } from '../src/App';
import en from '../src/i18n/en.json';
import { ScaleContext } from '../src/scale';
import { TrackContext, type Track } from '../src/events/track';
import { ScaleMode } from '../src/scaleMode/ScaleMode';
import { ScannerContext } from '../src/scanner';
import { fakeApi } from './support/api';
import { fakeScanner, type FakeScanner } from './support/scanner';

const nutrition = {
  kcal: 100,
  fat: 1,
  saturates: 0.5,
  carbs: 2,
  sugars: 1,
  protein: 10,
  salt: 0.1,
  fibre: null,
};
const curd = '033ee3fe-72a7-409c-8dc3-76626baa14db';
const milk = '2fb48689-9acc-4a8a-9b1f-f0bf8e44b474';
const catalog: Catalog = {
  ingredientClasses: [
    { id: 'curd', name: { en: 'Curd' } },
    { id: 'milk', name: { en: 'Milk' } },
  ],
  recipes: [
    {
      id: '9a13c2a4-8d6e-401e-aeb3-deb367561938',
      name: { en: 'Curd bowl' },
      steps: [
        {
          id: 'a6b75d73-d68a-4eec-8219-5a16aeb9917e',
          ingredientClassId: 'curd',
          defaultProductId: curd,
        },
        {
          id: 'b48924bb-4fa3-4843-b727-6928f03636d0',
          ingredientClassId: 'milk',
          defaultProductId: milk,
        },
      ],
    },
  ],
  products: [
    {
      id: curd,
      ingredientClassId: 'curd',
      name: 'Polmlek Twaróg',
      nutrition,
      source: 'seed',
      lastUsedAt: null,
    },
    {
      id: milk,
      ingredientClassId: 'milk',
      name: 'Mleko 3.2%',
      nutrition,
      source: 'seed',
      lastUsedAt: null,
    },
  ],
};

/** Scale Mode with a catalog that grows as products are added at a step (#64), as App's does. */
function Harness(props: Omit<Parameters<typeof ScaleMode>[0], 'catalog' | 'onProductAdded'>) {
  const [current, setCurrent] = useState(catalog);
  return (
    <ScaleMode
      {...props}
      catalog={current}
      onProductAdded={(product) =>
        setCurrent((c) => ({ ...c, products: [...c.products, product] }))
      }
    />
  );
}

const button = (name: string) => screen.getByRole('button', { name });
const liveWeight = () => screen.getByLabelText(en.scale.added);

/** Renders Scale Mode with a mock scale, picks the recipe and connects. */
async function session({
  connect = true,
  scanner = fakeScanner(),
  api: given,
}: { connect?: boolean; scanner?: FakeScanner; api?: Api } = {}) {
  const driver = new MockScaleDriver();
  const api = given ?? fakeApi({ catalog: () => Promise.resolve(catalog) });
  const onSaved = vi.fn();
  const track = vi.fn<Track>();
  const view = render(
    <ApiContext value={api}>
      <TrackContext value={track}>
        <ScannerContext value={scanner}>
          <ScaleContext value={() => driver}>
            <Harness
              onSaved={onSaved}
              onCancel={vi.fn()}
              owner="mlewand"
              tracker={{ stableWaitMs: 60 }}
              reconnect={{ firstDelayMs: 5, maxDelayMs: 10, giveUpAfterMs: 50 }}
            />
          </ScaleContext>
        </ScannerContext>
      </TrackContext>
    </ApiContext>,
  );
  fireEvent.click(button('Curd bowl'));
  if (connect) {
    fireEvent.click(button(en.scale.connect));
    await screen.findByText(en.scale.status.connected);
  }
  const script = scaleScript({ intervalMs: 5 });
  const play = (s: typeof script) => act(() => driver.play(s.take()));
  return { driver, api, onSaved, view, script, play, track };
}

/** Bowl on, Start. */
async function started() {
  const s = await session();
  await s.play(s.script.baseline(312, { forMs: 0 }));
  fireEvent.click(button(en.scale.start));
  return s;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Scale Mode', () => {
  it('M6-1: Connect scale connects, and the connection state stays visible', async () => {
    await session();
    expect(screen.getByText(en.scale.status.connected)).toBeVisible();
    expect(button(en.scale.start)).toBeVisible();
  });

  it('M6-1: connection changes are announced to screen readers (regression: #29)', async () => {
    await session({ connect: false });
    const status = screen.getByText(en.scale.status.idle);
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    fireEvent.click(button(en.scale.connect));
    expect(await screen.findByText(en.scale.status.connected)).toHaveAttribute(
      'aria-live',
      'polite',
    );
  });

  it('M6-1: a failed or cancelled connect offers Connect again', async () => {
    const s = await session({ connect: false });
    vi.spyOn(s.driver, 'connect').mockRejectedValueOnce(new Error('chooser cancelled'));
    fireEvent.click(button(en.scale.connect));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.scale.connectFailed);
    fireEvent.click(button(en.scale.connect));
    expect(await screen.findByText(en.scale.status.connected)).toBeVisible();
  });

  it('M6-2: Start is enabled only on a stable reading, and captures the baseline', async () => {
    const s = await session();
    await s.play(s.script.baseline(312, { forMs: 0 }).unstable({ forMs: 0 }));
    expect(button(en.scale.start)).toBeDisabled();
    await s.play(s.script.stable({ forMs: 0 }));
    fireEvent.click(button(en.scale.start));
    expect(screen.getByText('Step 1 of 2')).toBeVisible();
    expect(liveWeight()).toHaveTextContent('0 g');
  });

  it('M6-3: the step amount is large, and the scale total smaller', async () => {
    const s = await started();
    await s.play(s.script.add(214.5));
    expect(liveWeight()).toHaveTextContent('214.5 g');
    expect(liveWeight()).toHaveClass('live-weight');
    expect(screen.getByText('On the scale: 526.5 g')).toBeVisible();
  });

  it('M6-4: Next records the step and shows the recorded value', async () => {
    const s = await started();
    await s.play(s.script.add(214).stable({ forMs: 0 }));
    fireEvent.click(button(en.step.next));
    expect(screen.getByText('Step 2 of 2')).toBeVisible();
    expect(screen.getByText('Polmlek Twaróg: 214 g recorded')).toBeVisible();
    expect(liveWeight()).toHaveTextContent('0 g');
  });

  it('M3-4: Next on an unstable reading waits, then offers the reading to confirm', async () => {
    const s = await started();
    await s.play(s.script.add(214));
    fireEvent.click(button(en.step.next));
    expect(screen.getByRole('status')).toHaveTextContent(en.scale.waiting);
    await s.play(s.script.unstable({ forMs: 100 }));
    expect(screen.getByRole('status')).toHaveTextContent('Use 214 g?');
    expect(button(en.scale.readAgain)).toBeEnabled();
    expect(button(en.scale.enterManually)).toBeEnabled();
    fireEvent.click(button(en.scale.confirm));
    expect(screen.getByText('Polmlek Twaróg: 214 g recorded')).toBeVisible();
  });

  it('M3-6: a step below 0 asks for grams by hand, a new reading or undo', async () => {
    const s = await started();
    await s.play(s.script.add(214).stable({ forMs: 0 }));
    fireEvent.click(button(en.step.next));
    await s.play(s.script.tare().add(18).stable({ forMs: 0 }));
    fireEvent.click(button(en.step.next));
    expect(screen.getByRole('alert')).toHaveTextContent(en.scale.negative);
    expect(button(en.scale.readAgain)).toBeEnabled();
    expect(button(en.step.undo)).toBeEnabled();
    fireEvent.change(screen.getByLabelText(en.step.grams), { target: { value: '18,5' } });
    fireEvent.click(button(en.scale.useGrams));
    expect(screen.getByRole('heading', { name: en.summary.title })).toBeVisible();
  });

  it('M6-10: while the scale shows another unit, Start and Next are off and the screen asks for grams', async () => {
    const s = await session();
    await s.play(s.script.baseline(312, { forMs: 0 }).wrongUnit({ forMs: 0 }));
    expect(screen.getByRole('alert')).toHaveTextContent(en.scale.wrongUnit);
    expect(button(en.scale.start)).toBeDisabled();
    await s.play(s.script.stable({ forMs: 0 }));
    fireEvent.click(button(en.scale.start));
    await s.play(s.script.add(10).stable({ forMs: 0 }).wrongUnit({ forMs: 0 }));
    expect(button(en.step.next)).toBeDisabled();
    await s.play(s.script.stable({ forMs: 0 }));
    expect(button(en.step.next)).toBeEnabled();
  });

  it('M6-5: grams typed during the flow and in the summary save as manual; a scale meal saves as scale', async () => {
    const s = await started();
    await s.play(s.script.add(214).stable({ forMs: 0 }));
    fireEvent.click(button(en.step.next));
    fireEvent.click(button(en.scale.enterManually));
    fireEvent.change(screen.getByLabelText(en.step.grams), { target: { value: '50' } });
    fireEvent.click(button(en.scale.useGrams));
    // Summary: edit the curd, then save.
    expect(screen.getByText(en.scale.status.connected)).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Grams of Polmlek Twaróg' }), {
      target: { value: '200' },
    });
    fireEvent.click(button(en.summary.save));
    await vi.waitFor(() => expect(s.onSaved).toHaveBeenCalled());
    const request = vi.mocked(s.api.saveMeal).mock.calls[0]![0];
    expect(request.meal.inputMethod).toBe('scale');
    expect(request.meal.items.map((i) => (i.skipped ? '-' : [i.grams, i.weightSource]))).toEqual([
      [200, 'manual'],
      [50, 'manual'],
    ]);
  });

  it('M6-7: a Scale Mode meal is saved with its recording: every reading and every tap', async () => {
    const s = await session();
    const seen: number[] = [];
    s.driver.onReading((reading) => seen.push(reading.timestamp));
    await s.play(s.script.baseline(312, { forMs: 0 }));
    const atStart = seen.length;
    fireEvent.click(button(en.scale.start));
    await s.play(s.script.add(214).stable({ forMs: 0 }));
    fireEvent.click(button(en.step.next));
    fireEvent.click(button(en.step.skip));
    fireEvent.click(button(en.summary.save));
    await vi.waitFor(() => expect(s.onSaved).toHaveBeenCalled());
    const request = vi.mocked(s.api.saveMeal).mock.calls[0]![0];
    const recording = request.recording!;
    expect(recording.captureSessionId).toBe(request.meal.id);
    expect(recording.driverId).toBe(s.driver.id);
    expect(recording.trackerConfig.stableWaitMs).toBe(60);
    expect(recording.frames.map((f) => f.timestamp)).toEqual(seen);
    expect(recording.droppedFrames).toBe(0);
    expect(recording.events.map((e) => e.type)).toEqual(['start', 'next', 'skip']);
    // Each tap after the frames it saw.
    expect(recording.events.map((e) => e.afterFrames)).toEqual([atStart, seen.length, seen.length]);
  });

  it('M6-7, M3-11: the saved recording replays to the step amounts the scale recorded', async () => {
    const s = await started();
    await s.play(s.script.add(214).stable({ forMs: 0 }));
    fireEvent.click(button(en.step.next));
    await s.play(s.script.add(18).stable({ forMs: 0 }));
    fireEvent.click(button(en.step.next));
    fireEvent.click(button(en.summary.save));
    await vi.waitFor(() => expect(s.onSaved).toHaveBeenCalled());
    const request = vi.mocked(s.api.saveMeal).mock.calls[0]![0];
    // Without summary edits, which aren't recorded (#51), these are the meal's amounts.
    const replayed = replaySession(request.recording!).steps;
    expect(replayed.map((step) => (step.skipped ? '-' : step.grams))).toEqual(
      request.meal.items.map((item) => (item.skipped ? '-' : item.grams)),
    );
  });

  it('M6-7: taps that never reach the tracker are not recorded: after finishing by hand', async () => {
    const s = await started();
    await s.play(s.script.add(214).stable({ forMs: 0 }));
    fireEvent.click(button(en.step.next));
    s.driver.available = false;
    act(() => s.driver.drop());
    fireEvent.click(button(en.scale.finishByHand));
    // Typed grams and Next, then Undo and Next again: the flow's, not the scale's.
    fireEvent.change(screen.getByLabelText(en.step.grams), { target: { value: '18' } });
    fireEvent.click(button(en.step.next));
    fireEvent.click(button(en.step.undo));
    fireEvent.click(button(en.step.next));
    fireEvent.click(button(en.summary.save));
    await vi.waitFor(() => expect(s.onSaved).toHaveBeenCalled());
    const request = vi.mocked(s.api.saveMeal).mock.calls[0]![0];
    expect(request.recording!.events.map((e) => e.type)).toEqual(['start', 'next']);
  });

  it('M7-8: Scale Mode tracks its flow, steps, a manual correction, and a scale disconnect and reconnect', async () => {
    const s = await started();
    await s.play(s.script.add(214).stable({ forMs: 0 }));
    fireEvent.click(button(en.step.next));
    act(() => s.driver.drop());
    await screen.findByText(en.scale.status.connected);
    await s.play(s.script.stable({ forMs: 0 }));
    fireEvent.click(button(en.scale.enterManually));
    fireEvent.change(screen.getByLabelText(en.step.grams), { target: { value: '20' } });
    fireEvent.click(button(en.scale.useGrams));
    fireEvent.click(button(en.summary.save));
    await vi.waitFor(() => expect(s.onSaved).toHaveBeenCalled());
    const tracked = s.track.mock.calls.map(([name, props]) => [name, props]);
    expect(tracked.map(([name]) => name)).toEqual([
      'flow_started',
      'step_completed',
      'scale_disconnected',
      'scale_reconnected',
      'step_completed',
      'manual_correction',
      'flow_finished',
    ]);
    expect(tracked[1]![1]).toMatchObject({ inputMethod: 'scale', step: 0, weightSource: 'scale' });
    expect(tracked[3]![1]).toEqual({ durationMs: expect.any(Number) as number });
    expect(tracked[4]![1]).toMatchObject({ step: 1, weightSource: 'manual' });
  });

  it('M7-8: the first scale step counts its time from Start, not from the recipe pick (regression: #52)', async () => {
    // The real clock, moved ahead by hand where the test says time passes.
    const real = performance.now.bind(performance);
    let ahead = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => real() + ahead);
    try {
      const s = await session();
      // Connecting and putting the bowl on take a while.
      ahead = 60_000;
      await s.play(s.script.baseline(312, { forMs: 0 }));
      fireEvent.click(button(en.scale.start));
      ahead = 65_000;
      await s.play(s.script.add(214).stable({ forMs: 0 }));
      fireEvent.click(button(en.step.next));
      const completed = s.track.mock.calls.find(([name]) => name === 'step_completed');
      const durationMs = (completed?.[1] as { durationMs: number }).durationMs;
      expect(durationMs).toBeGreaterThanOrEqual(5000);
      expect(durationMs).toBeLessThan(10_000);
    } finally {
      now.mockRestore();
    }
  });

  it('M7-8: leaving the page in the middle of a Scale Mode meal tracks flow abandoned (regression: #52)', async () => {
    const s = await started();
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(s.track).toHaveBeenLastCalledWith('flow_abandoned', {
      inputMethod: 'scale',
      durationMs: expect.any(Number) as number,
    });
  });

  it('M7-8: a page kept in the back-forward cache has not abandoned its meal (regression: #52)', async () => {
    const s = await started();
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    });
    expect(s.track).not.toHaveBeenCalledWith('flow_abandoned', expect.anything());
    // Back from the cache, then really left.
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    });
    expect(s.track).toHaveBeenLastCalledWith('flow_abandoned', expect.anything());
  });

  it('M7-8: Undo on the first step, back to before Start, tracks step undone (regression: #52)', async () => {
    const s = await started();
    fireEvent.click(button(en.step.undo));
    expect(button(en.scale.start)).toBeInTheDocument();
    expect(s.track).toHaveBeenLastCalledWith('step_undone', { inputMethod: 'scale', step: 0 });
  });

  it('M7-8: leaving the page after the meal is saved tracks nothing more', async () => {
    const s = await started();
    await s.play(s.script.add(214).stable({ forMs: 0 }));
    fireEvent.click(button(en.step.next));
    fireEvent.click(button(en.step.skip));
    fireEvent.click(button(en.summary.save));
    await vi.waitFor(() => expect(s.onSaved).toHaveBeenCalled());
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(s.track).toHaveBeenLastCalledWith('flow_finished', expect.anything());
  });

  it('M5-8: a Scale Mode meal with no known owner is not sent (regression: #37)', async () => {
    const driver = new MockScaleDriver();
    const api = fakeApi({ catalog: () => Promise.resolve(catalog) });
    render(
      <ApiContext value={api}>
        <ScaleContext value={() => driver}>
          <Harness onSaved={vi.fn()} onCancel={vi.fn()} tracker={{ stableWaitMs: 60 }} />
        </ScaleContext>
      </ApiContext>,
    );
    fireEvent.click(button('Curd bowl'));
    fireEvent.click(button(en.scale.connect));
    await screen.findByText(en.scale.status.connected);
    act(() => driver.drop());
    fireEvent.click(await screen.findByRole('button', { name: en.scale.finishByHand }));
    for (const grams of ['10', '20']) {
      fireEvent.change(screen.getByLabelText(en.step.grams), { target: { value: grams } });
      fireEvent.click(button(en.step.next));
    }
    fireEvent.click(button(en.summary.save));
    expect(await screen.findByText(en.summary.saveFailed)).toBeInTheDocument();
    expect(api.saveMeal).not.toHaveBeenCalled();
  });

  it('M6-6: after a drop, it shows Reconnecting, keeps the session, and goes on once reconnected', async () => {
    const s = await started();
    await s.play(s.script.add(214).stable({ forMs: 0 }));
    fireEvent.click(button(en.step.next));
    s.driver.available = false;
    act(() => s.driver.drop());
    expect(screen.getByText(en.scale.status.reconnecting)).toBeVisible();
    expect(screen.getByText(en.scale.reconnectingHint)).toBeVisible();
    // Still at step 2, with the first step's weight; nothing reads the scale meanwhile.
    expect(screen.getByText('Step 2 of 2')).toBeVisible();
    expect(button(en.step.next)).toBeDisabled();
    expect(button(en.scale.enterManually)).toBeDisabled();
    const connect = vi.spyOn(s.driver, 'connect');
    s.driver.available = true;
    expect(await screen.findByText(en.scale.status.connected)).toBeVisible();
    // Without the chooser: the driver reconnects by itself (see HuajunDriver).
    expect(connect).toHaveBeenCalled();
    await s.play(s.script.add(50).stable({ forMs: 0 }));
    expect(screen.queryByText(en.scale.reconnectingHint)).not.toBeInTheDocument();
    fireEvent.click(button(en.step.next));
    expect(screen.getByRole('heading', { name: en.summary.title })).toBeVisible();
    fireEvent.click(button(en.summary.save));
    await vi.waitFor(() => expect(s.onSaved).toHaveBeenCalled());
    const request = vi.mocked(s.api.saveMeal).mock.calls[0]![0];
    expect(request.meal.items.map((i) => (i.skipped ? '-' : [i.grams, i.weightSource]))).toEqual([
      [214, 'scale'],
      [50, 'scale'],
    ]);
  });

  it('M6-6: before Start, a drop also reconnects, and Start waits for it', async () => {
    const s = await session();
    await s.play(s.script.baseline(312, { forMs: 0 }));
    s.driver.available = false;
    act(() => s.driver.drop());
    expect(screen.getByText(en.scale.status.reconnecting)).toBeVisible();
    expect(button(en.scale.start)).toBeDisabled();
    s.driver.available = true;
    await screen.findByText(en.scale.status.connected);
    await s.play(s.script.stable({ forMs: 0 }));
    expect(button(en.scale.start)).toBeEnabled();
  });

  it('M6-6: reconnected but with no reading yet, the meal can still be finished by hand (regression: #36)', async () => {
    const s = await started();
    act(() => s.driver.drop());
    // The mock reconnects at once but plays nothing: a stalled stream.
    expect(await screen.findByText(en.scale.status.connected)).toBeVisible();
    expect(button(en.step.next)).toBeDisabled();
    expect(screen.getByText(en.scale.reconnectingHint)).toBeVisible();
    fireEvent.click(button(en.scale.finishByHand));
    expect(screen.getByRole('alert')).toHaveTextContent(en.scale.dropped);
  });

  it('M6-6: the first reading after reconnecting hides the notice', async () => {
    const s = await started();
    act(() => s.driver.drop());
    await screen.findByText(en.scale.status.connected);
    await s.play(s.script.stable({ forMs: 0 }));
    expect(screen.queryByText(en.scale.reconnectingHint)).not.toBeInTheDocument();
  });

  it('M6-6: Finish by hand stops reconnecting and takes typed grams', async () => {
    const s = await started();
    s.driver.available = false;
    act(() => s.driver.drop());
    const connect = vi.spyOn(s.driver, 'connect');
    fireEvent.click(button(en.scale.finishByHand));
    expect(screen.getByRole('alert')).toHaveTextContent(en.scale.dropped);
    const attempts = connect.mock.calls.length;
    s.driver.available = true;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(connect).toHaveBeenCalledTimes(attempts);
    expect(screen.getByText(en.scale.status.dropped)).toBeVisible();
  });

  it('M6-5, M6-6: when reconnecting fails, the remaining steps take typed grams', async () => {
    const s = await started();
    await s.play(s.script.add(214).stable({ forMs: 0 }));
    fireEvent.click(button(en.step.next));
    s.driver.available = false;
    act(() => s.driver.drop());
    expect(await screen.findByText(en.scale.status.dropped)).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(en.scale.dropped);
    fireEvent.change(screen.getByLabelText(en.step.grams), { target: { value: '50,5' } });
    fireEvent.click(button(en.step.next));
    expect(screen.getByRole('heading', { name: en.summary.title })).toBeVisible();
    fireEvent.click(button(en.summary.save));
    await vi.waitFor(() => expect(s.onSaved).toHaveBeenCalled());
    const request = vi.mocked(s.api.saveMeal).mock.calls[0]![0];
    expect(request.meal.inputMethod).toBe('scale');
    expect(request.meal.items.map((i) => (i.skipped ? '-' : [i.grams, i.weightSource]))).toEqual([
      [214, 'scale'],
      [50.5, 'manual'],
    ]);
  });

  it('M6-5: undo after the scale drops shows the grams of the step again (regression: #27)', async () => {
    const s = await started();
    await s.play(s.script.add(214).stable({ forMs: 0 }));
    fireEvent.click(button(en.step.next));
    s.driver.available = false;
    act(() => s.driver.drop());
    fireEvent.click(button(en.scale.finishByHand));
    fireEvent.click(button(en.step.undo));
    expect(screen.getByText('Step 1 of 2')).toBeVisible();
    expect(screen.getByLabelText(en.step.grams)).toHaveValue('214');
  });

  it('M6-10: grams by hand are off while the scale shows another unit (regression: #27)', async () => {
    const s = await started();
    await s.play(s.script.wrongUnit({ forMs: 0 }));
    expect(button(en.scale.enterManually)).toBeDisabled();
  });

  it('M6-5: typed grams wait until the weight settles (regression: #27)', async () => {
    const s = await started();
    await s.play(s.script.add(100).stable({ forMs: 0 }));
    fireEvent.click(button(en.scale.enterManually));
    await s.play(s.script.add(20));
    expect(button(en.scale.useGrams)).toBeDisabled();
    expect(screen.getByText(en.scale.correctionNeedsStable)).toBeVisible();
    await s.play(s.script.stable({ forMs: 0 }));
    expect(button(en.scale.useGrams)).toBeEnabled();
  });

  it('M6-5: after the scale drops, each step focuses the grams input', async () => {
    const s = await started();
    await s.play(s.script.add(214).stable({ forMs: 0 }));
    s.driver.available = false;
    act(() => s.driver.drop());
    fireEvent.click(button(en.scale.finishByHand));
    expect(screen.getByLabelText(en.step.grams)).toHaveFocus();
    fireEvent.change(screen.getByLabelText(en.step.grams), { target: { value: '200' } });
    fireEvent.click(button(en.step.next));
    expect(screen.getByText('Step 2 of 2')).toBeVisible();
    expect(screen.getByLabelText(en.step.grams)).toHaveFocus();
  });

  it('M6-5: Enter grams by hand focuses the grams input, and a negative step does not', async () => {
    const s = await started();
    await s.play(s.script.add(214).stable({ forMs: 0 }));
    fireEvent.click(button(en.scale.enterManually));
    expect(screen.getByLabelText(en.step.grams)).toHaveFocus();
    fireEvent.change(screen.getByLabelText(en.step.grams), { target: { value: '214' } });
    fireEvent.click(button(en.scale.useGrams));
    // A negative step shows the input by itself: no keyboard over the live weight.
    await s.play(s.script.tare().add(18).stable({ forMs: 0 }));
    fireEvent.click(button(en.step.next));
    expect(screen.getByRole('alert')).toHaveTextContent(en.scale.negative);
    expect(screen.getByLabelText(en.step.grams)).not.toHaveFocus();
  });

  it('M3-3: skip and undo work on the scale steps', async () => {
    await started();
    fireEvent.click(button(en.step.skip));
    expect(screen.getByText('Step 2 of 2')).toBeVisible();
    fireEvent.click(button(en.step.undo));
    expect(screen.getByText('Step 1 of 2')).toBeVisible();
    // Undo on the first step goes back to Start, to take the baseline again.
    fireEvent.click(button(en.step.undo));
    expect(button(en.scale.start)).toBeEnabled();
  });

  it('M6-9: holds a wake lock during the session, takes it again when visible, and releases it at the end', async () => {
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => Promise.resolve({ release }));
    vi.stubGlobal('navigator', { ...navigator, wakeLock: { request } });
    const s = await session();
    expect(request).toHaveBeenCalledWith('screen');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledTimes(2);
    s.view.unmount();
    expect(release).toHaveBeenCalled();
  });

  it('M6-9: a failing wake lock never blocks the session', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      wakeLock: { request: () => Promise.reject(new Error('not allowed')) },
    });
    await session();
    expect(button(en.scale.start)).toBeVisible();
  });
});

describe('Home', () => {
  it('#88-1: a Scale Mode meal, once saved, also opens the main screen with the notice', async () => {
    const api: Api = fakeApi({ catalog: () => Promise.resolve(catalog) });
    const driver = new MockScaleDriver();
    render(
      <ApiContext value={api}>
        <ScaleContext value={() => driver}>
          <App />
        </ScaleContext>
      </ApiContext>,
    );
    fireEvent.click(await screen.findByRole('button', { name: en.home.weighMeal }));
    fireEvent.click(await screen.findByRole('button', { name: 'Curd bowl' }));
    fireEvent.click(button(en.scale.connect));
    await screen.findByText(en.scale.status.connected);
    await act(() => driver.play(scaleScript({ intervalMs: 5 }).baseline(312, { forMs: 0 }).take()));
    fireEvent.click(button(en.scale.start));
    fireEvent.click(button(en.step.skip));
    fireEvent.click(button(en.step.skip));
    fireEvent.click(button(en.summary.save));
    expect(await screen.findByText(en.saved.title)).toBeVisible();
    expect(button(en.home.weighMeal)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  });

  it('M6-1: offers Scale Mode next to Direct Entry', async () => {
    const api: Api = fakeApi({ catalog: () => Promise.resolve(catalog) });
    const driver = new MockScaleDriver();
    render(
      <ApiContext value={api}>
        <ScaleContext value={() => driver}>
          <App />
        </ScaleContext>
      </ApiContext>,
    );
    fireEvent.click(await screen.findByRole('button', { name: en.home.weighMeal }));
    const recipes = await screen.findByRole('heading', { name: en.recipes.title });
    expect(within(recipes.parentElement!).getByRole('button', { name: 'Curd bowl' })).toBeVisible();
  });

  it('M7-8: leaving the page mid Scale Mode meal sends flow abandoned with the last batch (regression: #52)', async () => {
    const api: Api = fakeApi({ catalog: () => Promise.resolve(catalog) });
    const driver = new MockScaleDriver();
    render(
      <ApiContext value={api}>
        <ScaleContext value={() => driver}>
          <App />
        </ScaleContext>
      </ApiContext>,
    );
    fireEvent.click(await screen.findByRole('button', { name: en.home.weighMeal }));
    fireEvent.click(await screen.findByRole('button', { name: 'Curd bowl' }));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await vi.waitFor(() => expect(api.sendEvents).toHaveBeenCalled());
    expect(vi.mocked(api.sendEvents).mock.calls[0]![0].map((e) => e.name)).toEqual([
      'flow_started',
      'flow_abandoned',
    ]);
  });
});

describe('the scale stays connected between meals (#89)', () => {
  function app() {
    const driver = new MockScaleDriver();
    const connect = vi.spyOn(driver, 'connect');
    const api: Api = fakeApi({ catalog: () => Promise.resolve(catalog) });
    render(
      <ApiContext value={api}>
        <ScaleContext value={() => driver}>
          <App />
        </ScaleContext>
      </ApiContext>,
    );
    return { driver, connect, api };
  }

  /** Home → Weigh a meal → Curd bowl. */
  async function weigh() {
    fireEvent.click(await screen.findByRole('button', { name: en.home.weighMeal }));
    fireEvent.click(await screen.findByRole('button', { name: 'Curd bowl' }));
  }

  /** One meal with every step skipped, saved, and back on the home screen. */
  async function meal(driver: MockScaleDriver, { connect }: { connect: boolean }) {
    await weigh();
    if (connect) {
      fireEvent.click(button(en.scale.connect));
      await screen.findByText(en.scale.status.connected);
    }
    const script = scaleScript({ intervalMs: 5 });
    await act(() => driver.play(script.baseline(312, { forMs: 0 }).take()));
    fireEvent.click(button(en.scale.start));
    fireEvent.click(button(en.step.skip));
    fireEvent.click(button(en.step.skip));
    fireEvent.click(button(en.summary.save));
    await screen.findByText(en.saved.title);
  }

  it('#89-1: after a saved meal, the next one starts at the bowl prompt without connecting again (regression: #89)', async () => {
    const { driver, connect } = app();
    await meal(driver, { connect: true });
    await weigh();
    expect(screen.queryByRole('button', { name: en.scale.connect })).toBeNull();
    expect(screen.getByText(en.scale.placeBowl)).toBeVisible();
    expect(screen.getByText(en.scale.status.connected)).toBeVisible();
    // The first reading of the new meal makes Start available, as before.
    const script = scaleScript({ intervalMs: 5 });
    await act(() => driver.play(script.baseline(312, { forMs: 0 }).take()));
    expect(button(en.scale.start)).toBeEnabled();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('#89-1: a second meal on the held connection is saved like the first (regression: #89)', async () => {
    const { driver, connect, api } = app();
    await meal(driver, { connect: true });
    await meal(driver, { connect: false });
    expect(vi.mocked(api.saveMeal)).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('#89-2: a scale gone by the next meal shows the connect screen, never a stale connected state', async () => {
    const { driver } = app();
    await meal(driver, { connect: true });
    act(() => driver.drop());
    await weigh();
    expect(button(en.scale.connect)).toBeEnabled();
    expect(screen.queryByText(en.scale.status.connected)).toBeNull();
    // Connecting again works as for the first time.
    fireEvent.click(button(en.scale.connect));
    await screen.findByText(en.scale.status.connected);
    expect(screen.getByText(en.scale.placeBowl)).toBeVisible();
  });

  it('#89-3: a drop between meals shows nothing on the home screen and starts no reconnect', async () => {
    const { driver, connect } = app();
    await meal(driver, { connect: true });
    act(() => driver.drop());
    // Nothing to see or say on Home, and nothing tried: a reconnect would have called connect.
    expect(button(en.home.weighMeal)).toBeVisible();
    expect(screen.queryByText(en.scale.status.reconnecting)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("#89-4: readings between meals are not in the next meal's recording", async () => {
    const { driver, api } = app();
    await meal(driver, { connect: true });
    const script = scaleScript({ intervalMs: 5 });
    await act(() => driver.play(script.baseline(250, { forMs: 0 }).take()));
    await meal(driver, { connect: false });
    const second = vi.mocked(api.saveMeal).mock.calls[1]![0];
    // Only the reading played during the second meal.
    expect(second.recording?.frames.map((f) => f.reading.grams)).toEqual([312]);
  });
});

describe('adding a product at a step (#64-6)', () => {
  it('#64-6: the scale connection and the wake lock survive the form, and the weighing goes on', async () => {
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => Promise.resolve({ release }));
    // A spread copy of navigator has lost onLine, which lives on its prototype.
    vi.stubGlobal('navigator', { ...navigator, onLine: true, wakeLock: { request } });
    const s = await session();
    const disconnect = vi.spyOn(s.driver, 'disconnect');
    await s.play(s.script.baseline(312, { forMs: 0 }));
    fireEvent.click(button(en.scale.start));
    expect(request).toHaveBeenCalledTimes(1);

    fireEvent.click(button(en.step.addProduct));
    // Readings keep coming while the form is open.
    await s.play(s.script.add(150));
    fireEvent.change(screen.getByLabelText(en.product.name), {
      target: { value: 'Homemade curd' },
    });
    fireEvent.click(button(en.product.save));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(screen.getByText(en.scale.status.connected)).toBeVisible();
    expect(disconnect).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    // The product is selected for the step, and the weight added meanwhile is still counted.
    const added = vi.mocked(s.api.createProduct).mock.calls[0]![0];
    expect(screen.getByLabelText('Homemade curd')).toBeChecked();
    expect(screen.getByText('Step 1 of 2')).toBeVisible();
    await s.play(s.script.stable({ forMs: 0 }));
    fireEvent.click(button(en.step.next));
    expect(await screen.findByText('Step 2 of 2')).toBeVisible();
    expect(
      screen.getByText(
        en.scale.recorded.replace('{{product}}', 'Homemade curd').replace('{{grams}}', '150'),
      ),
    ).toBeVisible();
    expect(added.ingredientClassId).toBe('curd');
  });

  it('#65-7: scanning a barcode keeps the scale connected and the screen awake, and selects the product', async () => {
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => Promise.resolve({ release }));
    vi.stubGlobal('navigator', { ...navigator, onLine: true, wakeLock: { request } });
    const scanner = fakeScanner();
    const found = {
      ...catalog.products[0]!,
      id: '7a1f3d52-8c4e-4b6a-9d20-3e5f6a7b8c9d',
      name: 'Scanned curd',
    };
    const api = fakeApi({
      catalog: () => Promise.resolve(catalog),
      productByBarcode: () => Promise.resolve(found),
    });
    const s = await session({ scanner, api });
    const disconnect = vi.spyOn(s.driver, 'disconnect');
    await s.play(s.script.baseline(312, { forMs: 0 }));
    fireEvent.click(button(en.scale.start));

    fireEvent.click(button(en.step.scan));
    await waitFor(() => expect(scanner.open).toBe(true));
    // The scale goes on streaming while the camera is up.
    await s.play(s.script.add(150));
    act(() => scanner.read('5901234123457'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(screen.getByText(en.scale.status.connected)).toBeVisible();
    expect(disconnect).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Scanned curd')).toBeChecked();
    await s.play(s.script.stable({ forMs: 0 }));
    fireEvent.click(button(en.step.next));
    expect(await screen.findByText('Step 2 of 2')).toBeVisible();
  });
});
