import { localDay, type Today } from '@macrofill/domain';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiContext, type Api } from '../src/api/api';
import { App } from '../src/App';
import en from '../src/i18n/en.json';
import { OutboxStoreContext } from '../src/outbox/Outbox';
import { indexedDbOutbox } from '../src/outbox/store';
import { REFRESH_INTERVAL_MS, REFRESH_STALLED_MS } from '../src/today/TodayView';
import { emptyToday, fakeApi } from './support/api';
import { outboxItem } from './support/outbox';

const nutrition = {
  kcal: 100,
  fat: 1,
  saturates: 0,
  carbs: 1,
  sugars: 0,
  protein: 5,
  salt: 0,
  fibre: 0,
};
const meal = (id: string, name: string) => ({
  id,
  preparedMealId: id,
  eatenAt: '2026-01-15T06:05:00.000Z',
  recipeName: { en: name },
  nutrition,
});
const curd = meal('f1c7a5e6-8b9d-4c0e-9f1a-1b0c9d8e7f6a', 'Curd');
const sandwich = meal('c8f4d2b3-5e6a-4f7b-8c9d-8e7f6a5b4c3d', 'Sandwich');
const withMeals = (...entries: Today['entries']): Today => ({
  ...emptyToday,
  // The real current day, so a meal waiting in the outbox counts toward it.
  day: localDay(new Date(), emptyToday.timezone),
  entries,
});

const focus = () => act(() => void window.dispatchEvent(new Event('focus')));
const tick = () => act(() => void vi.advanceTimersByTime(REFRESH_INTERVAL_MS));
/** Lets the promises of a response run. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

let visibility: DocumentVisibilityState = 'visible';
beforeEach(() => {
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  // Only the interval and the clock: waiting for responses relies on the real timeouts.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderApp(api: Api, outbox = indexedDbOutbox(new IDBFactory())) {
  render(
    <ApiContext value={api}>
      <OutboxStoreContext value={outbox}>
        <App />
      </OutboxStoreContext>
    </ApiContext>,
  );
}

/** An Api whose Today answers are the given days in turn (the last one stays), counting the loads. */
function days(...answers: Array<Today | Error>) {
  let n = 0;
  return fakeApi({
    today: () => {
      const answer = answers[Math.min(n++, answers.length - 1)]!;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  });
}

const names = () =>
  screen.queryAllByRole('listitem').map((e) => within(e).getByRole('strong').textContent);

describe('Today refreshes itself (#77)', () => {
  it('#77-1: the window getting focus loads the day again', async () => {
    const api = days(withMeals(curd), withMeals(sandwich, curd));
    renderApp(api);
    await screen.findByText('Curd');
    expect(api.today).toHaveBeenCalledTimes(1);

    focus();
    await screen.findByText('Sandwich');
    expect(api.today).toHaveBeenCalledTimes(2);
  });

  it('#77-1: a window gaining focus while the tab is hidden does not load', async () => {
    const api = days(withMeals(curd), withMeals(sandwich, curd));
    renderApp(api);
    await screen.findByText('Curd');

    visibility = 'hidden';
    focus();
    await settle();
    expect(api.today).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Sandwich')).not.toBeInTheDocument();
  });

  it('#77-2: it loads the day every 30 seconds while the tab is visible', async () => {
    const api = days(withMeals(curd), withMeals(sandwich, curd));
    renderApp(api);
    await screen.findByText('Curd');

    act(() => void vi.advanceTimersByTime(REFRESH_INTERVAL_MS - 1));
    await settle();
    expect(api.today).toHaveBeenCalledTimes(1);

    tick();
    await screen.findByText('Sandwich');
    expect(api.today).toHaveBeenCalledTimes(2);
    tick();
    await settle();
    expect(api.today).toHaveBeenCalledTimes(3);
  });

  it('#77-2: a hidden tab does not poll, and polls again once visible', async () => {
    const api = days(withMeals(curd));
    renderApp(api);
    await screen.findByText('Curd');

    visibility = 'hidden';
    tick();
    tick();
    await settle();
    expect(api.today).toHaveBeenCalledTimes(1);

    visibility = 'visible';
    tick();
    await settle();
    expect(api.today).toHaveBeenCalledTimes(2);
  });

  it('#77-3: the list and totals stay on screen while the new day is on its way', async () => {
    let answer!: (today: Today) => void;
    const first = withMeals(curd);
    const api = fakeApi({
      today: vi
        .fn<Api['today']>()
        .mockResolvedValueOnce(first)
        .mockImplementation(() => new Promise((resolve) => (answer = resolve))),
    });
    renderApp(api);
    await screen.findByText('Curd');

    focus();
    await settle();
    expect(api.today).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Curd')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByText(en.app.loading)).not.toBeInTheDocument();

    answer(withMeals(sandwich, curd));
    await screen.findByText('Sandwich');
    expect(names()).toEqual(['Sandwich', 'Curd']);
  });

  it('#77-4: a refresh that fails keeps the day and shows no error; the next one tries again', async () => {
    const api = days(withMeals(curd), new TypeError('Failed to fetch'), withMeals(sandwich, curd));
    renderApp(api);
    await screen.findByText('Curd');

    focus();
    await settle();
    expect(api.today).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Curd')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    tick();
    await screen.findByText('Sandwich');
    expect(api.today).toHaveBeenCalledTimes(3);
  });

  it('#77-4: a refresh that works after Today failed to load brings the day back', async () => {
    const api = days(new TypeError('Failed to fetch'), withMeals(curd));
    renderApp(api);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.today.loadFailed);

    tick();
    await screen.findByText('Curd');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('#77-5: no second load starts while one is in flight', async () => {
    let answer!: (today: Today) => void;
    const api = fakeApi({
      today: vi
        .fn<Api['today']>()
        .mockResolvedValueOnce(withMeals(curd))
        .mockImplementation(() => new Promise((resolve) => (answer = resolve))),
    });
    renderApp(api);
    await screen.findByText('Curd');

    // Focus twice, and the interval's tick comes while the first load is only 5 s old.
    act(() => void vi.advanceTimersByTime(REFRESH_INTERVAL_MS - 5_000));
    focus();
    focus();
    act(() => void vi.advanceTimersByTime(5_000));
    await settle();
    expect(api.today).toHaveBeenCalledTimes(2);

    answer(withMeals(sandwich, curd));
    await screen.findByText('Sandwich');
    focus();
    await settle();
    expect(api.today).toHaveBeenCalledTimes(3);
  });

  it('#77-5: a refresh that never answers does not stop the next ones (regression: #79)', async () => {
    const answers: Array<(today: Today) => void> = [];
    const api = fakeApi({
      today: vi
        .fn<Api['today']>()
        .mockResolvedValueOnce(withMeals(curd))
        .mockImplementation(() => new Promise((resolve) => answers.push(resolve))),
    });
    renderApp(api);
    await screen.findByText('Curd');

    focus();
    await settle();
    expect(api.today).toHaveBeenCalledTimes(2);
    // Still out well within its limit: no second one.
    act(() => void vi.advanceTimersByTime(REFRESH_STALLED_MS - 1));
    focus();
    await settle();
    expect(api.today).toHaveBeenCalledTimes(2);

    // Never answered by the next tick: given up on, and the tick loads again.
    tick();
    await settle();
    expect(api.today).toHaveBeenCalledTimes(3);
    answers[1]!(withMeals(sandwich, curd));
    await screen.findByText('Sandwich');

    // The answer that comes late, with older data, is dropped.
    answers[0]!(withMeals(curd));
    await settle();
    expect(names()).toEqual(['Sandwich', 'Curd']);
  });

  it('#77-5: nothing loads while the server has not confirmed the user', async () => {
    let confirm!: (user: string) => void;
    const api = fakeApi({
      me: vi
        .fn<Api['me']>()
        .mockResolvedValueOnce('mlewand')
        .mockImplementation(() => new Promise((resolve) => (confirm = resolve))),
    });
    renderApp(api);
    await screen.findByText(en.today.empty);
    expect(api.today).toHaveBeenCalledTimes(1);

    // Back on the tab: the user is asked again, and nothing of Today shows or loads until then.
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await settle();
    focus();
    tick();
    await settle();
    expect(api.today).toHaveBeenCalledTimes(1);

    confirm('mlewand');
    await vi.waitFor(() => expect(api.today).toHaveBeenCalledTimes(2));
  });

  it('#77-5: a refresh answering after a later load of the day does not overwrite it', async () => {
    let late!: (today: Today) => void;
    let current = withMeals(sandwich, curd);
    const api = fakeApi({
      today: vi
        .fn<Api['today']>()
        .mockResolvedValueOnce(current)
        .mockImplementationOnce(() => new Promise((resolve) => (late = resolve)))
        .mockImplementation(() => Promise.resolve(current)),
      deleteEntry: () => {
        current = withMeals(curd);
        return Promise.resolve();
      },
    });
    renderApp(api);
    await screen.findByText('Sandwich');

    focus();
    await settle();
    // Deleting reloads the day while the refresh is still out.
    fireEvent.click(screen.getByRole('button', { name: /^Delete Sandwich/ }));
    fireEvent.click(screen.getByRole('button', { name: en.today.confirm }));
    await vi.waitFor(() => expect(screen.queryByText('Sandwich')).not.toBeInTheDocument());

    late(withMeals(sandwich, curd));
    await settle();
    expect(screen.queryByText('Sandwich')).not.toBeInTheDocument();
  });

  it('#77-6: a meal waiting in the outbox stays in the list after a refresh', async () => {
    const outbox = indexedDbOutbox(new IDBFactory());
    await outbox.add(outboxItem(1, new Date().toISOString()));
    // The server never takes it, so it stays pending.
    const api = fakeApi({
      saveMeal: () => new Promise(() => undefined),
      today: vi
        .fn<Api['today']>()
        .mockResolvedValueOnce(withMeals(curd))
        .mockResolvedValue(withMeals(sandwich, curd)),
    });
    renderApp(api, outbox);
    expect(await screen.findByText(en.today.pending)).toBeInTheDocument();

    focus();
    await screen.findByText('Sandwich');
    expect(screen.getByText(en.today.pending)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(await outbox.all()).toHaveLength(1);
  });
});
