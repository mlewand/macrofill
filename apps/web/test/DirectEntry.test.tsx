import { localDay, type Catalog, type SaveMealRequest, type Today } from '@macrofill/domain';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiContext, ApiError, type Api } from '../src/api/api';
import { OutboxProvider, OutboxStoreContext, useSaveMeal } from '../src/outbox/Outbox';
import { indexedDbOutbox, type OutboxStore } from '../src/outbox/store';
import { App } from '../src/App';
import type { DirectEntryState } from '../src/directEntry/state';
import {
  DraftContext,
  indexedDbDraftStore,
  type Draft,
  type DraftStore,
} from '../src/storage/drafts';
import en from '../src/i18n/en.json';
import { rememberUser } from '../src/session';
import { emptyToday, fakeApi as baseFakeApi, stored } from './support/api';
import { outboxItem } from './support/outbox';

const nutrition = (protein: number, fibre: number | null = null) => ({
  kcal: 100,
  fat: 1,
  saturates: 0.5,
  carbs: 2,
  sugars: 1,
  protein,
  salt: 0.1,
  fibre,
});

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
          defaultProductId: '033ee3fe-72a7-409c-8dc3-76626baa14db',
        },
        { id: 'b48924bb-4fa3-4843-b727-6928f03636d0', ingredientClassId: 'milk' },
      ],
    },
    { id: '29c28733-1275-4740-beaa-62b5eea1e4cd', name: { en: 'Sandwich' }, steps: [] },
  ],
  products: [
    {
      id: '033ee3fe-72a7-409c-8dc3-76626baa14db',
      ingredientClassId: 'curd',
      name: 'Polmlek Twaróg',
      nutrition: nutrition(17),
      source: 'seed',
      lastUsedAt: null,
    },
    {
      id: '1de22574-2eab-46f7-bd0f-4910acdb36c2',
      ingredientClassId: 'curd',
      name: 'Almette Curd',
      nutrition: nutrition(11),
      source: 'seed',
      lastUsedAt: null,
    },
    {
      id: '2fb48689-9acc-4a8a-9b1f-f0bf8e44b474',
      ingredientClassId: 'milk',
      name: 'Mleko 3.2%',
      nutrition: nutrition(3, 0),
      source: 'seed',
      lastUsedAt: '2026-01-10T08:00:00.000Z',
    },
    {
      id: '2597fc57-8e69-4c9e-9740-20091002f416',
      ingredientClassId: 'milk',
      name: 'Mleko 0.5%',
      nutrition: nutrition(3, 0),
      source: 'seed',
      lastUsedAt: '2026-01-12T08:00:00.000Z',
    },
  ],
};

function fakeApi(saveMeal?: Api['saveMeal'], overrides: Partial<Api> = {}): Api {
  return baseFakeApi({
    catalog: () => Promise.resolve(catalog),
    ...(saveMeal ? { saveMeal } : {}),
    ...overrides,
  });
}

/** Renders the app and waits for its first screen (it shows once the kept session is known). */
async function renderApp(api = fakeApi()) {
  render(
    <ApiContext value={api}>
      <App />
    </ApiContext>,
  );
  await screen.findByRole('button', { name: en.home.logMeal });
  return api;
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const grams = () => screen.getByLabelText(en.step.grams);
const typeGrams = (value: string) => fireEvent.change(grams(), { target: { value } });
const radios = () =>
  within(screen.getByRole('group', { name: en.step.product })).getAllByRole('radio');
const checkedProduct = () =>
  radios()
    .filter((r) => (r as HTMLInputElement).checked)
    .map((r) => r.closest('label')?.textContent);

async function openCurdBowl(api?: Api) {
  const used = await renderApp(api);
  click(en.home.logMeal);
  fireEvent.click(await screen.findByRole('button', { name: 'Curd bowl' }));
  return used;
}

describe('Direct Entry', () => {
  it('M5-3: each step focuses the grams input, so no extra tap is needed', async () => {
    await openCurdBowl();
    expect(grams()).toHaveFocus();
    typeGrams('200');
    click(en.step.next);
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
    expect(grams()).toHaveFocus();
    click(en.step.undo);
    expect(grams()).toHaveFocus();
  });

  it('M5-1: the user picks a recipe from the seeded list', async () => {
    await renderApp();
    click(en.home.logMeal);
    expect(await screen.findByRole('button', { name: 'Curd bowl' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sandwich' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Curd bowl' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Curd' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
  });

  it('M5-2: the picker lists only the step class, with the default preselected when there is no history', async () => {
    await openCurdBowl();
    expect(radios().map((r) => r.closest('label')?.textContent)).toEqual([
      'Polmlek Twaróg',
      'Almette Curd',
    ]);
    expect(checkedProduct()).toEqual(['Polmlek Twaróg']);
  });

  it('M5-2: the picker is sorted by most recent use, which is preselected', async () => {
    await openCurdBowl();
    typeGrams('200');
    click(en.step.next);
    expect(radios().map((r) => r.closest('label')?.textContent)).toEqual([
      'Mleko 0.5%',
      'Mleko 3.2%',
    ]);
    expect(checkedProduct()).toEqual(['Mleko 0.5%']);
  });

  it.each([
    ['', en.step.problem.empty],
    ['abc', en.step.problem.invalid],
    ['-5', en.step.problem.negative],
  ])('M5-3: grams %j is rejected with a message', async (input, message) => {
    await openCurdBowl();
    typeGrams(input);
    click(en.step.next);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
  });

  it.each(['3,2', '3.2'])('M5-3: grams %j is accepted', async (input) => {
    await openCurdBowl();
    typeGrams(input);
    click(en.step.next);
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
  });

  it('M5-4: the user can skip a step', async () => {
    await openCurdBowl();
    click(en.step.skip);
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
  });

  it('M5-5: Undo returns to the previous step with its product and grams restored', async () => {
    await openCurdBowl();
    fireEvent.click(screen.getByRole('radio', { name: 'Almette Curd' }));
    typeGrams('212,5');
    click(en.step.next);
    click(en.step.undo);
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
    expect(checkedProduct()).toEqual(['Almette Curd']);
    expect(grams()).toHaveValue('212,5');
  });

  it('M5-5: Undo is disabled on the first step', async () => {
    await openCurdBowl();
    expect(screen.getByRole('button', { name: en.step.undo })).toBeDisabled();
  });

  it("M5-6: the summary shows the items and the meal's macros, and grams can be edited", async () => {
    await openCurdBowl();
    typeGrams('200');
    click(en.step.next);
    click(en.step.skip);

    expect(screen.getByRole('heading', { name: en.summary.title })).toBeInTheDocument();
    expect(screen.getByText(en.summary.skipped)).toBeInTheDocument();
    const table = () => screen.getByRole('table');
    // 200 g at 17 g protein per 100 g; the curd has unknown fibre (M2-3).
    expect(within(table()).getByRole('row', { name: /Protein/ })).toHaveTextContent('34 g');
    expect(within(table()).getByRole('row', { name: /Fibre/ })).toHaveTextContent(en.unknown);
    expect(within(table()).getByRole('row', { name: /Energy/ })).toHaveTextContent('200 kcal');

    fireEvent.change(screen.getByRole('textbox', { name: 'Grams of Polmlek Twaróg' }), {
      target: { value: '150,5' },
    });
    expect(within(table()).getByRole('row', { name: /Protein/ })).toHaveTextContent('25.6 g');
  });

  it('M5-6: invalid grams in the summary disable Save', async () => {
    await openCurdBowl();
    typeGrams('200');
    click(en.step.next);
    click(en.step.skip);
    fireEvent.change(screen.getByRole('textbox', { name: 'Grams of Polmlek Twaróg' }), {
      target: { value: '' },
    });
    expect(screen.getByRole('button', { name: en.summary.save })).toBeDisabled();
  });

  it('saves the meal and confirms it', async () => {
    const api = await openCurdBowl();
    typeGrams('3,2');
    click(en.step.next);
    click(en.step.skip);
    click(en.summary.save);
    expect(await screen.findByRole('status')).toHaveTextContent(en.saved.title);
    const [request] = vi.mocked(api.saveMeal).mock.calls[0]!;
    expect(request.meal.items).toEqual([
      {
        stepId: catalog.recipes[0]!.steps[0]!.id,
        skipped: false,
        productId: catalog.products[0]!.id,
        grams: 3.2,
        weightSource: 'manual',
      },
      { stepId: catalog.recipes[0]!.steps[1]!.id, skipped: true },
    ]);
  });

  it('a failed save can be retried, with the same meal and entry ids (M4-6)', async () => {
    let attempts = 0;
    const api = await openCurdBowl(
      fakeApi((request) =>
        ++attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(stored(request)),
      ),
    );
    click(en.step.skip);
    click(en.step.skip);
    click(en.summary.save);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.summary.saveFailed);
    click(en.summary.save);
    expect(await screen.findByRole('status')).toHaveTextContent(en.saved.title);
    const [first, second] = vi.mocked(api.saveMeal).mock.calls.map(([request]) => request);
    expect(second).toEqual(first);
  });

  it('a save in flight freezes the summary (regression: #16)', async () => {
    await openCurdBowl(fakeApi(() => new Promise(() => {})));
    typeGrams('200');
    click(en.step.next);
    click(en.step.skip);
    click(en.summary.save);
    expect(screen.getByRole('textbox', { name: 'Grams of Polmlek Twaróg' })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.step.undo })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.summary.saving })).toBeDisabled();
  });

  it('after a failed save the summary stays frozen, and a retry resends the first request (regression: #16)', async () => {
    let attempts = 0;
    const api = await openCurdBowl(
      fakeApi((request) =>
        ++attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(stored(request)),
      ),
    );
    typeGrams('200');
    click(en.step.next);
    click(en.step.skip);
    click(en.summary.save);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.summary.saveFailed);

    // The first request may have reached the server, so its content must not change.
    const input = screen.getByRole('textbox', { name: 'Grams of Polmlek Twaróg' });
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: en.step.undo })).toBeDisabled();
    fireEvent.change(input, { target: { value: '999' } });

    click(en.summary.save);
    expect(await screen.findByRole('status')).toHaveTextContent(en.saved.title);
    const [first, second] = vi.mocked(api.saveMeal).mock.calls.map(([request]) => request);
    expect(second).toEqual(first);
    expect(second?.meal.items[0]).toMatchObject({ grams: 200 });
  });

  it('an immediate double tap on Save sends one request', async () => {
    const api = await openCurdBowl(fakeApi(() => new Promise(() => {})));
    click(en.step.skip);
    click(en.step.skip);
    const save = screen.getByRole('button', { name: en.summary.save });
    fireEvent.click(save);
    fireEvent.click(save);
    // The request goes out once the draft has it.
    await vi.waitFor(() => expect(api.saveMeal).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.saveMeal).toHaveBeenCalledTimes(1);
  });
});

/** An in-memory draft store, as IndexedDB would keep it across a reload. */
function memoryDrafts(initial?: DirectEntryState, sent?: SaveMealRequest) {
  let kept: Draft | undefined = initial && { state: initial, ...(sent ? { sent } : {}) };
  const store: DraftStore = {
    load: vi.fn(() => Promise.resolve(kept)),
    save: vi.fn((draft: Draft) => {
      kept = draft;
      return Promise.resolve(true);
    }),
    clear: vi.fn(() => {
      kept = undefined;
      return Promise.resolve(true);
    }),
  };
  return { store, kept: () => kept?.state, keptSent: () => kept?.sent };
}

function renderWithDrafts(drafts: DraftStore, api = fakeApi()) {
  const view = render(
    <ApiContext value={api}>
      <DraftContext value={drafts}>
        <App />
      </DraftContext>
    </ApiContext>,
  );
  return { api, view };
}

const curdBowl = catalog.recipes[0]!;
const draftAtMilk: DirectEntryState = {
  recipe: curdBowl,
  inputMethod: 'direct',
  mealId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
  entryId: 'c8f4d2b3-5e6a-4f7b-8c9d-8e7f6a5b4c3d',
  startedAt: '2026-01-15T07:00:00.000Z',
  steps: [
    { productId: '1de22574-2eab-46f7-bd0f-4910acdb36c2', grams: '150', skipped: false },
    { productId: '2fb48689-9acc-4a8a-9b1f-f0bf8e44b474', grams: '3,5', skipped: false },
  ],
  current: 1,
};

describe('Direct Entry across a reload (M5-8)', () => {
  it('M5-8: every change to the session is kept, from picking the recipe on', async () => {
    const drafts = memoryDrafts();
    renderWithDrafts(drafts.store);
    fireEvent.click(await screen.findByRole('button', { name: en.home.logMeal }));
    fireEvent.click(await screen.findByRole('button', { name: 'Curd bowl' }));
    await vi.waitFor(() => expect(drafts.kept()).toMatchObject({ current: 0 }));
    typeGrams('200');
    click(en.step.next);
    await vi.waitFor(() =>
      expect(drafts.kept()).toMatchObject({ current: 1, steps: [{ grams: '200' }, {}] }),
    );
  });

  it('M5-8: a kept session resumes at the same step, with what was entered', async () => {
    const drafts = memoryDrafts(draftAtMilk);
    renderWithDrafts(drafts.store);
    expect(await screen.findByText('Step 2 of 2')).toBeInTheDocument();
    expect(grams()).toHaveValue('3,5');
    click(en.step.undo);
    expect(grams()).toHaveValue('150');
    expect(checkedProduct()).toEqual(['Almette Curd']);
  });

  it('M5-8: saving the meal clears the kept session, with the ids it started with', async () => {
    const drafts = memoryDrafts({ ...draftAtMilk, current: 2 });
    const { api } = renderWithDrafts(drafts.store);
    fireEvent.click(await screen.findByRole('button', { name: en.summary.save }));
    await screen.findByText(en.saved.title);
    expect(drafts.kept()).toBeUndefined();
    expect(vi.mocked(api.saveMeal).mock.calls[0]![0]).toMatchObject({
      meal: { id: draftAtMilk.mealId, startedAt: draftAtMilk.startedAt },
      consumptionEntry: { id: draftAtMilk.entryId },
    });
  });

  it('M5-8: after a reload, a meal whose save was sent stays frozen and resends that request (regression: #37)', async () => {
    const saveMeal = vi.fn<Api['saveMeal']>().mockRejectedValueOnce(new Error('offline'));
    const first = memoryDrafts({ ...draftAtMilk, current: 2 });
    const { view } = renderWithDrafts(first.store, fakeApi(saveMeal));
    fireEvent.click(await screen.findByRole('button', { name: en.summary.save }));
    await screen.findByText(en.summary.saveFailed);
    await vi.waitFor(() => expect(first.keptSent()).toBeDefined());
    const request = saveMeal.mock.calls[0]![0];
    view.unmount();

    // Reloaded: the summary is still frozen, and Save sends the very same request.
    const again = memoryDrafts(first.kept(), first.keptSent());
    const retry = vi.fn<Api['saveMeal']>((r) => Promise.resolve(stored(r)));
    renderWithDrafts(again.store, fakeApi(retry));
    await screen.findByRole('heading', { name: en.summary.title });
    expect(screen.getByRole('textbox', { name: /Almette Curd/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: en.step.discard })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.summary.save }));
    await screen.findByText(en.saved.title);
    expect(retry).toHaveBeenCalledWith(request);
  });

  it('M5-8: a session whose save was sent resumes as it was, even if the catalog changed (regression: #37)', async () => {
    const saveMeal = vi.fn<Api['saveMeal']>().mockRejectedValueOnce(new Error('offline'));
    const first = memoryDrafts({ ...draftAtMilk, current: 2 });
    const { view } = renderWithDrafts(first.store, fakeApi(saveMeal));
    fireEvent.click(await screen.findByRole('button', { name: en.summary.save }));
    await screen.findByText(en.summary.saveFailed);
    await vi.waitFor(() => expect(first.keptSent()).toBeDefined());
    const request = saveMeal.mock.calls[0]![0];
    view.unmount();

    // The curd moved to another ingredient class since.
    const moved = {
      ...catalog,
      products: catalog.products.map((p) =>
        p.id === draftAtMilk.steps[0]!.productId ? { ...p, ingredientClassId: 'milk' } : p,
      ),
    };
    const again = memoryDrafts(first.kept(), first.keptSent());
    const retry = vi.fn<Api['saveMeal']>((r) => Promise.resolve(stored(r)));
    renderWithDrafts(
      again.store,
      baseFakeApi({ catalog: () => Promise.resolve(moved), saveMeal: retry }),
    );
    fireEvent.click(await screen.findByRole('button', { name: en.summary.save }));
    await screen.findByText(en.saved.title);
    expect(retry).toHaveBeenCalledWith(request);
  });

  it('M5-8: a session kept for another user is dropped, not resumed (regression: #37)', async () => {
    localStorage.setItem('macrofill.user', 'other');
    try {
      const drafts = memoryDrafts();
      await drafts.store.save({ state: draftAtMilk, username: 'mlewand' });
      renderWithDrafts(
        drafts.store,
        baseFakeApi({
          catalog: () => Promise.resolve(catalog),
          me: () => Promise.resolve('other'),
        }),
      );
      expect(await screen.findByRole('button', { name: en.home.logMeal })).toBeInTheDocument();
      expect(drafts.kept()).toBeUndefined();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: logging in as someone else mid-meal drops the session and goes home (regression: #37)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const drafts = memoryDrafts();
      await drafts.store.save({ state: draftAtMilk, username: 'mlewand' });
      const catalogCall = vi
        .fn<Api['catalog']>()
        .mockRejectedValueOnce(new ApiError(401))
        .mockResolvedValue(catalog);
      renderWithDrafts(
        drafts.store,
        baseFakeApi({ catalog: catalogCall, login: () => Promise.resolve('ok') }),
      );
      const dialog = await screen.findByRole('dialog', { name: en.login.title });
      fireEvent.change(within(dialog).getByLabelText(en.login.username), {
        target: { value: 'other' },
      });
      fireEvent.change(within(dialog).getByLabelText(en.login.password), {
        target: { value: 'the password' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: en.login.submit }));
      expect(await screen.findByRole('button', { name: en.home.logMeal })).toBeInTheDocument();
      expect(drafts.kept()).toBeUndefined();
      expect(localStorage.getItem('macrofill.user')).toBe('other');
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: the first request is kept on the device before it is sent (regression: #37)', async () => {
    const drafts = memoryDrafts({ ...draftAtMilk, current: 2 });
    let keptBeforeSending: SaveMealRequest | undefined;
    const saveMeal = vi.fn<Api['saveMeal']>((request) => {
      keptBeforeSending = drafts.keptSent();
      return Promise.resolve(stored(request));
    });
    renderWithDrafts(drafts.store, fakeApi(saveMeal));
    fireEvent.click(await screen.findByRole('button', { name: en.summary.save }));
    await screen.findByText(en.saved.title);
    expect(keptBeforeSending).toEqual(saveMeal.mock.calls[0]![0]);
  });

  it('M5-8: logging in when nobody was known yet drops the open session (regression: #37)', async () => {
    localStorage.clear();
    const drafts = memoryDrafts(draftAtMilk);
    const catalogCall = vi
      .fn<Api['catalog']>()
      .mockRejectedValueOnce(new ApiError(401))
      .mockResolvedValue(catalog);
    renderWithDrafts(
      drafts.store,
      baseFakeApi({ catalog: catalogCall, login: () => Promise.resolve('ok') }),
    );
    const dialog = await screen.findByRole('dialog', { name: en.login.title });
    fireEvent.change(within(dialog).getByLabelText(en.login.username), {
      target: { value: 'someone' },
    });
    fireEvent.change(within(dialog).getByLabelText(en.login.password), {
      target: { value: 'the password' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.login.submit }));
    expect(await screen.findByRole('button', { name: en.home.logMeal })).toBeInTheDocument();
    expect(drafts.kept()).toBeUndefined();
    localStorage.clear();
  });

  it('M5-8: a login in another tab as someone else drops the open session (regression: #37)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const drafts = memoryDrafts();
      await drafts.store.save({ state: draftAtMilk, username: 'mlewand' });
      // The server names whoever logged in last, as the shared cookie does.
      renderWithDrafts(
        drafts.store,
        baseFakeApi({
          catalog: () => Promise.resolve(catalog),
          me: () => Promise.resolve(localStorage.getItem('macrofill.user') ?? 'mlewand'),
        }),
      );
      await screen.findByText('Step 2 of 2');
      localStorage.setItem('macrofill.user', 'other');
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: 'macrofill.user',
            oldValue: 'mlewand',
            newValue: 'other',
          }),
        );
      });
      expect(await screen.findByRole('button', { name: en.home.logMeal })).toBeInTheDocument();
      expect(drafts.kept()).toBeUndefined();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: an open session keeps the owner it started with (regression: #37)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const drafts = memoryDrafts();
      renderWithDrafts(drafts.store);
      fireEvent.click(await screen.findByRole('button', { name: en.home.logMeal }));
      fireEvent.click(await screen.findByRole('button', { name: 'Curd bowl' }));
      // Changed elsewhere, before this tab heard of it.
      localStorage.setItem('macrofill.user', 'other');
      typeGrams('100');
      await vi.waitFor(() =>
        expect(vi.mocked(drafts.store.save).mock.calls.at(-1)![0].state.steps[0]!.grams).toBe(
          '100',
        ),
      );
      expect(vi.mocked(drafts.store.save).mock.calls.at(-1)![0].username).toBe('mlewand');
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: a save whose user changed while its request was being kept is not sent (regression: #37)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const drafts = memoryDrafts();
      await drafts.store.save({ state: { ...draftAtMilk, current: 2 }, username: 'mlewand' });
      // Another tab logs in as someone else while the request is being kept.
      vi.mocked(drafts.store.save).mockImplementation(() => {
        localStorage.setItem('macrofill.user', 'other');
        return Promise.resolve(true);
      });
      const saveMeal = vi.fn<Api['saveMeal']>((r) => Promise.resolve(stored(r)));
      renderWithDrafts(drafts.store, fakeApi(saveMeal));
      fireEvent.click(await screen.findByRole('button', { name: en.summary.save }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(saveMeal).not.toHaveBeenCalled();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: if the request can not be kept, the editable draft goes, and the save is sent (regression: #37)', async () => {
    const drafts = memoryDrafts({ ...draftAtMilk, current: 2 });
    vi.mocked(drafts.store.save).mockResolvedValue(false);
    const saveMeal = vi.fn<Api['saveMeal']>((r) => Promise.resolve(stored(r)));
    renderWithDrafts(drafts.store, fakeApi(saveMeal));
    fireEvent.click(await screen.findByRole('button', { name: en.summary.save }));
    await screen.findByText(en.saved.title);
    expect(drafts.store.clear).toHaveBeenCalled();
    expect(saveMeal).toHaveBeenCalledTimes(1);
  });

  it('M5-8: if neither the request can be kept nor the draft cleared, nothing is sent (regression: #37)', async () => {
    const drafts = memoryDrafts({ ...draftAtMilk, current: 2 });
    vi.mocked(drafts.store.save).mockResolvedValue(false);
    vi.mocked(drafts.store.clear).mockResolvedValue(false);
    const saveMeal = vi.fn<Api['saveMeal']>((r) => Promise.resolve(stored(r)));
    renderWithDrafts(drafts.store, fakeApi(saveMeal));
    fireEvent.click(await screen.findByRole('button', { name: en.summary.save }));
    expect(await screen.findByText(en.summary.saveFailed)).toBeInTheDocument();
    expect(saveMeal).not.toHaveBeenCalled();
  });

  it('M5-8: the save names the user the session belongs to, for the server to check (regression: #37)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const drafts = memoryDrafts();
      await drafts.store.save({ state: { ...draftAtMilk, current: 2 }, username: 'mlewand' });
      const saveMeal = vi.fn<Api['saveMeal']>((r) => Promise.resolve(stored(r)));
      renderWithDrafts(drafts.store, fakeApi(saveMeal));
      fireEvent.click(await screen.findByRole('button', { name: en.summary.save }));
      await screen.findByText(en.saved.title);
      expect(saveMeal.mock.calls[0]![0].username).toBe('mlewand');
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: a discard that can not remove the kept session says so and stays (regression: #37)', async () => {
    const drafts = memoryDrafts(draftAtMilk);
    vi.mocked(drafts.store.clear).mockResolvedValue(false);
    renderWithDrafts(drafts.store);
    await screen.findByText('Step 2 of 2');
    click(en.step.discard);
    click(en.step.confirmDiscard);
    expect(await screen.findByText(en.step.discardFailed)).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
  });

  it('M5-8: after a save, a failed removal of the kept session is tried again (regression: #37)', async () => {
    const drafts = memoryDrafts({ ...draftAtMilk, current: 2 });
    vi.mocked(drafts.store.clear).mockResolvedValueOnce(false);
    renderWithDrafts(drafts.store);
    fireEvent.click(await screen.findByRole('button', { name: en.summary.save }));
    await screen.findByText(en.saved.title);
    expect(drafts.store.clear).toHaveBeenCalledTimes(2);
    expect(drafts.kept()).toBeUndefined();
  });

  it('M5-8: the app learns from the server who is logged in, and saves name them (regression: #37)', async () => {
    localStorage.clear();
    const drafts = memoryDrafts({ ...draftAtMilk, current: 2 });
    const saveMeal = vi.fn<Api['saveMeal']>((r) => Promise.resolve(stored(r)));
    renderWithDrafts(drafts.store, fakeApi(saveMeal));
    await vi.waitFor(() => expect(localStorage.getItem('macrofill.user')).toBe('mlewand'));
    fireEvent.click(await screen.findByRole('button', { name: en.summary.save }));
    await screen.findByText(en.saved.title);
    expect(saveMeal.mock.calls[0]![0].username).toBe('mlewand');
    localStorage.clear();
  });

  it('M5-8: without local storage, the user the server names still owns the saves (regression: #37)', async () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    try {
      const drafts = memoryDrafts({ ...draftAtMilk, current: 2 });
      const saveMeal = vi.fn<Api['saveMeal']>((r) => Promise.resolve(stored(r)));
      renderWithDrafts(drafts.store, fakeApi(saveMeal));
      const save = await screen.findByRole('button', { name: en.summary.save });
      await new Promise((resolve) => setTimeout(resolve, 20));
      fireEvent.click(save);
      await screen.findByText(en.saved.title);
      expect(saveMeal.mock.calls[0]![0].username).toBe('mlewand');
    } finally {
      get.mockRestore();
      set.mockRestore();
      // Storage works again: a save brings it up to date, then the next test starts empty.
      rememberUser('mlewand');
      localStorage.clear();
    }
  });

  it('M5-8: an ownerless session never takes on a user who shows up later (regression: #37)', async () => {
    localStorage.clear();
    try {
      const drafts = memoryDrafts({ ...draftAtMilk, current: 2 });
      // Another tab logs in as someone while the request is being kept.
      const keep = vi.mocked(drafts.store.save).getMockImplementation()!;
      vi.mocked(drafts.store.save).mockImplementation((draft) => {
        localStorage.setItem('macrofill.user', 'other');
        return keep(draft);
      });
      const saveMeal = vi.fn<Api['saveMeal']>((r) => Promise.resolve(stored(r)));
      renderWithDrafts(
        drafts.store,
        baseFakeApi({
          catalog: () => Promise.resolve(catalog),
          saveMeal,
          me: () => Promise.reject(new TypeError('offline')),
        }),
      );
      // With nobody known, the session doesn't even open: nothing can be sent for nobody.
      expect(await screen.findByText(en.home.userUnknown)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: en.summary.save })).not.toBeInTheDocument();
      expect(saveMeal).not.toHaveBeenCalled();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: a login in another tab as someone else reloads Today for them (regression: #37)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const today = vi.fn(() => Promise.resolve(emptyToday));
      renderWithDrafts(
        memoryDrafts().store,
        baseFakeApi({ catalog: () => Promise.resolve(catalog), today }),
      );
      await screen.findByRole('button', { name: en.home.logMeal });
      await vi.waitFor(() => expect(today).toHaveBeenCalled());
      const loads = today.mock.calls.length;
      localStorage.setItem('macrofill.user', 'other');
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'macrofill.user', newValue: 'other' }),
        );
      });
      await vi.waitFor(() => expect(today.mock.calls.length).toBeGreaterThan(loads));
    } finally {
      localStorage.clear();
    }
  });

  it("M5-8: a kept session the server says isn't this user's is dropped (regression: #37)", async () => {
    localStorage.clear();
    try {
      const drafts = memoryDrafts();
      await drafts.store.save({ state: draftAtMilk, username: 'mlewand' });
      renderWithDrafts(
        drafts.store,
        baseFakeApi({
          catalog: () => Promise.resolve(catalog),
          me: () => Promise.resolve('other'),
        }),
      );
      expect(await screen.findByRole('button', { name: en.home.logMeal })).toBeInTheDocument();
      expect(screen.queryByText('Step 2 of 2')).not.toBeInTheDocument();
      expect(drafts.kept()).toBeUndefined();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: coming back to the tab checks who is logged in again (regression: #37)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const drafts = memoryDrafts();
      await drafts.store.save({ state: draftAtMilk, username: 'mlewand' });
      const me = vi.fn<Api['me']>().mockResolvedValueOnce('mlewand').mockResolvedValue('other');
      renderWithDrafts(drafts.store, baseFakeApi({ catalog: () => Promise.resolve(catalog), me }));
      await screen.findByText('Step 2 of 2');
      await vi.waitFor(() => expect(me).toHaveBeenCalledTimes(1));
      // Another tab logged in as someone else, with no storage event to say so.
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(await screen.findByRole('button', { name: en.home.logMeal })).toBeInTheDocument();
      expect(drafts.kept()).toBeUndefined();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: an unstamped kept session waits until the user is known, then resumes (regression: #37)', async () => {
    localStorage.clear();
    try {
      const drafts = memoryDrafts(draftAtMilk);
      const me = vi
        .fn<Api['me']>()
        .mockRejectedValueOnce(new TypeError('offline'))
        .mockResolvedValue('mlewand');
      const saveMeal = vi.fn<Api['saveMeal']>((r) => Promise.resolve(stored(r)));
      renderWithDrafts(
        drafts.store,
        baseFakeApi({ catalog: () => Promise.resolve(catalog), me, saveMeal }),
      );
      expect(await screen.findByText(en.home.userUnknown)).toBeInTheDocument();
      expect(screen.queryByText('Step 2 of 2')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: en.app.retry }));
      expect(await screen.findByText('Step 2 of 2')).toBeInTheDocument();
      click(en.step.next);
      fireEvent.click(await screen.findByRole('button', { name: en.summary.save }));
      await screen.findByText(en.saved.title);
      expect(saveMeal.mock.calls[0]![0].username).toBe('mlewand');
    } finally {
      localStorage.clear();
    }
  });

  it("M5-8: a stamped kept session waits until the user is known, and isn't shown to someone else (regression: #37)", async () => {
    localStorage.clear();
    try {
      const drafts = memoryDrafts();
      await drafts.store.save({ state: draftAtMilk, username: 'mlewand' });
      const me = vi
        .fn<Api['me']>()
        .mockRejectedValueOnce(new TypeError('offline'))
        .mockResolvedValue('other');
      renderWithDrafts(drafts.store, baseFakeApi({ catalog: () => Promise.resolve(catalog), me }));
      expect(await screen.findByText(en.home.userUnknown)).toBeInTheDocument();
      expect(screen.queryByText('Step 2 of 2')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: en.app.retry }));
      await vi.waitFor(() =>
        expect(screen.getByRole('button', { name: en.home.logMeal })).toBeEnabled(),
      );
      expect(screen.queryByText('Step 2 of 2')).not.toBeInTheDocument();
      await vi.waitFor(() => expect(drafts.kept()).toBeUndefined());
    } finally {
      localStorage.clear();
    }
  });

  it("M5-8: a kept session waits for the server's answer about the user, not just the remembered one (regression: #37)", async () => {
    // Remembered here: mlewand. Another tab logged in as someone else but couldn't save it.
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const drafts = memoryDrafts();
      await drafts.store.save({ state: draftAtMilk, username: 'mlewand' });
      let answer!: (username: string) => void;
      const me = vi.fn<Api['me']>(() => new Promise<string>((resolve) => (answer = resolve)));
      renderWithDrafts(drafts.store, baseFakeApi({ catalog: () => Promise.resolve(catalog), me }));
      await vi.waitFor(() => expect(me).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByText('Step 2 of 2')).not.toBeInTheDocument();
      act(() => answer('other'));
      // Home starts over for them.
      await vi.waitFor(() =>
        expect(screen.getByRole('button', { name: en.home.logMeal })).toBeInTheDocument(),
      );
      expect(screen.queryByText('Step 2 of 2')).not.toBeInTheDocument();
      await vi.waitFor(() => expect(drafts.kept()).toBeUndefined());
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: offline, a kept session of the remembered user still resumes', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const drafts = memoryDrafts();
      await drafts.store.save({ state: draftAtMilk, username: 'mlewand' });
      renderWithDrafts(
        drafts.store,
        baseFakeApi({
          catalog: () => Promise.resolve(catalog),
          me: () => Promise.reject(new TypeError('offline')),
        }),
      );
      expect(await screen.findByText('Step 2 of 2')).toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: a waiting unstamped session dropped by a login leaves Home, not a new meal (regression: #37)', async () => {
    localStorage.clear();
    try {
      const drafts = memoryDrafts(draftAtMilk);
      const me = vi
        .fn<Api['me']>()
        .mockRejectedValueOnce(new ApiError(401))
        .mockResolvedValue('someone');
      renderWithDrafts(
        drafts.store,
        baseFakeApi({
          catalog: () => Promise.resolve(catalog),
          me,
          login: () => Promise.resolve('ok'),
        }),
      );
      const dialog = await screen.findByRole('dialog', { name: en.login.title });
      fireEvent.change(within(dialog).getByLabelText(en.login.username), {
        target: { value: 'someone' },
      });
      fireEvent.change(within(dialog).getByLabelText(en.login.password), {
        target: { value: 'pw' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: en.login.submit }));
      expect(await screen.findByRole('button', { name: en.home.logMeal })).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.getByRole('button', { name: en.home.logMeal })).toBeInTheDocument();
      expect(drafts.kept()).toBeUndefined();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: a 401 for a question asked before a login does not ask to log in again (regression: #37)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      let refuse!: () => void;
      // No session: log in. Asked again meanwhile (back on the tab), that answer comes late.
      const me = vi
        .fn<Api['me']>()
        .mockRejectedValueOnce(new ApiError(401))
        .mockImplementationOnce(
          () => new Promise<string>((_, reject) => (refuse = () => reject(new ApiError(401)))),
        )
        .mockResolvedValue('mlewand');
      renderWithDrafts(
        memoryDrafts().store,
        baseFakeApi({
          catalog: () => Promise.resolve(catalog),
          me,
          today: () => Promise.resolve(emptyToday),
          login: () => Promise.resolve('ok'),
        }),
      );
      const dialog = await screen.findByRole('dialog', { name: en.login.title });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await vi.waitFor(() => expect(me).toHaveBeenCalledTimes(2));
      fireEvent.change(within(dialog).getByLabelText(en.login.username), {
        target: { value: 'mlewand' },
      });
      fireEvent.change(within(dialog).getByLabelText(en.login.password), {
        target: { value: 'pw' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: en.login.submit }));
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      act(() => refuse());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: an answer about the user that a login made stale is ignored (regression: #37)', async () => {
    localStorage.clear();
    try {
      let answer!: (username: string) => void;
      // The first answer is held back; asked again after the login elsewhere, it's the new user.
      const me = vi
        .fn<Api['me']>()
        .mockImplementationOnce(() => new Promise<string>((resolve) => (answer = resolve)))
        .mockResolvedValue('other');
      renderWithDrafts(
        memoryDrafts().store,
        baseFakeApi({ catalog: () => Promise.resolve(catalog), me }),
      );
      await vi.waitFor(() => expect(me).toHaveBeenCalled());
      // Another tab logs in as someone else before the answer arrives.
      localStorage.setItem('macrofill.user', 'other');
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'macrofill.user', newValue: 'other' }),
        );
      });
      await screen.findByRole('button', { name: en.home.logMeal });
      act(() => answer('mlewand'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(localStorage.getItem('macrofill.user')).toBe('other');
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: while the user is unknown, no meal can be started; trying again learns it (regression: #37)', async () => {
    localStorage.clear();
    try {
      const me = vi
        .fn<Api['me']>()
        .mockRejectedValueOnce(new TypeError('offline'))
        .mockResolvedValue('mlewand');
      renderWithDrafts(
        memoryDrafts().store,
        baseFakeApi({ catalog: () => Promise.resolve(catalog), me }),
      );
      expect(await screen.findByText(en.home.userUnknown)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: en.home.logMeal })).toBeDisabled();
      expect(screen.getByRole('button', { name: en.home.weighMeal })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: en.app.retry }));
      await vi.waitFor(() =>
        expect(screen.getByRole('button', { name: en.home.logMeal })).toBeEnabled(),
      );
      expect(screen.queryByText(en.home.userUnknown)).not.toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: a save whose user is unknown is not sent (regression: #37)', async () => {
    localStorage.clear();
    const drafts = memoryDrafts({ ...draftAtMilk, current: 2 });
    const saveMeal = vi.fn<Api['saveMeal']>((r) => Promise.resolve(stored(r)));
    renderWithDrafts(
      drafts.store,
      baseFakeApi({
        catalog: () => Promise.resolve(catalog),
        saveMeal,
        me: () => Promise.reject(new TypeError('offline')),
      }),
    );
    // With nobody known, the session doesn't even open: nothing can be sent for nobody.
    expect(await screen.findByText(en.home.userUnknown)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.summary.save })).not.toBeInTheDocument();
    expect(saveMeal).not.toHaveBeenCalled();
  });

  it('M5-8: drafts are stamped with the user who last logged in', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const drafts = memoryDrafts();
      renderWithDrafts(drafts.store);
      fireEvent.click(await screen.findByRole('button', { name: en.home.logMeal }));
      fireEvent.click(await screen.findByRole('button', { name: 'Curd bowl' }));
      await vi.waitFor(() => expect(drafts.store.save).toHaveBeenCalled());
      expect(vi.mocked(drafts.store.save).mock.calls.at(-1)![0].username).toBe('mlewand');
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: Discard meal, once confirmed, clears the kept session and goes home', async () => {
    const drafts = memoryDrafts(draftAtMilk);
    renderWithDrafts(drafts.store);
    await screen.findByText('Step 2 of 2');
    click(en.step.discard);
    // Asks first; Keep goes back to the step.
    click(en.step.keep);
    expect(drafts.kept()).toBeDefined();
    click(en.step.discard);
    click(en.step.confirmDiscard);
    expect(await screen.findByRole('button', { name: en.home.logMeal })).toBeInTheDocument();
    expect(drafts.kept()).toBeUndefined();
  });

  it('M5-8: the summary can discard the meal too', async () => {
    const drafts = memoryDrafts({ ...draftAtMilk, current: 2 });
    renderWithDrafts(drafts.store);
    await screen.findByRole('heading', { name: en.summary.title });
    click(en.step.discard);
    click(en.step.confirmDiscard);
    expect(await screen.findByRole('button', { name: en.home.logMeal })).toBeInTheDocument();
    expect(drafts.kept()).toBeUndefined();
  });

  it('M5-8: a session for a recipe whose steps changed since is dropped', async () => {
    const changed = {
      ...draftAtMilk,
      recipe: { ...curdBowl, steps: curdBowl.steps.slice(0, 1) },
      steps: draftAtMilk.steps.slice(0, 1),
      current: 0,
    };
    const drafts = memoryDrafts(changed);
    renderWithDrafts(drafts.store);
    expect(await screen.findByRole('heading', { name: en.recipes.title })).toBeInTheDocument();
    expect(drafts.kept()).toBeUndefined();
  });

  it('M5-8: nothing can be started before the kept session has loaded (regression: #37)', async () => {
    let loaded!: (draft: Draft) => void;
    const store: DraftStore = {
      load: () => new Promise((resolve) => (loaded = resolve)),
      save: vi.fn(() => Promise.resolve(true)),
      clear: vi.fn(() => Promise.resolve(true)),
    };
    renderWithDrafts(store);
    expect(screen.queryByRole('button', { name: en.home.logMeal })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.home.weighMeal })).not.toBeInTheDocument();
    loaded({ state: draftAtMilk });
    expect(await screen.findByText('Step 2 of 2')).toBeInTheDocument();
  });

  it('M5-8: a kept product that now belongs to another ingredient class is unpicked (regression: #37)', async () => {
    const drafts = memoryDrafts({
      ...draftAtMilk,
      current: 0,
      // A milk product at the curd step.
      steps: [
        { productId: '2fb48689-9acc-4a8a-9b1f-f0bf8e44b474', grams: '150', skipped: false },
        draftAtMilk.steps[1]!,
      ],
    });
    renderWithDrafts(drafts.store);
    await screen.findByText('Step 1 of 2');
    expect(checkedProduct()).toEqual([]);
    click(en.step.next);
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
  });

  it('M5-8: a kept product that is gone from the catalog is unpicked', async () => {
    const drafts = memoryDrafts({
      ...draftAtMilk,
      current: 0,
      steps: [
        { productId: '7d0f4a1e-0000-4000-8000-000000000000', grams: '150', skipped: false },
        draftAtMilk.steps[1]!,
      ],
    });
    renderWithDrafts(drafts.store);
    await screen.findByText('Step 1 of 2');
    expect(checkedProduct()).toEqual([]);
  });
});

describe('saving through the outbox (M5-9)', () => {
  /** Today for the real current day, so a meal saved now counts toward it. */
  const todayNow = (): Promise<Today> =>
    Promise.resolve({ ...emptyToday, day: localDay(new Date(), emptyToday.timezone) });

  /**
   * The fixture meals' day, for the offline list (today's only): 2026-01-15, 07:30 UTC. Only `Date`
   * is faked; it's still the 14th in Los Angeles (this device) and the 15th in Warsaw (the user).
   */
  const onFixtureDay = () =>
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-15T07:30:00.000Z') });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderWithOutbox(api: Api, outbox: OutboxStore, draft?: DirectEntryState) {
    const drafts = memoryDrafts(draft);
    render(
      <ApiContext value={api}>
        <OutboxStoreContext value={outbox}>
          <DraftContext value={drafts.store}>
            <App />
          </DraftContext>
        </OutboxStoreContext>
      </ApiContext>,
    );
    return drafts;
  }

  const atSummary = { ...draftAtMilk, current: 2 };

  it('M5-9: a meal saved offline is kept, pending in Today and counted, and sent once back online', async () => {
    let online = false;
    const saveMeal = vi.fn<Api['saveMeal']>((r) =>
      online ? Promise.resolve(stored(r)) : Promise.reject(new TypeError('Failed to fetch')),
    );
    const today = vi.fn(todayNow);
    const outbox = indexedDbOutbox(new IDBFactory());
    const drafts = renderWithOutbox(fakeApi(saveMeal, { today }), outbox, atSummary);

    fireEvent.click(await screen.findByRole('button', { name: en.summary.save }));
    expect(await screen.findByText(en.saved.pending)).toBeInTheDocument();
    expect(drafts.kept()).toBeUndefined();
    expect(await outbox.all()).toHaveLength(1);

    click(en.saved.done);
    const entry = await screen.findByText(en.today.pending);
    expect(entry.closest('li')).toHaveTextContent('Curd bowl');
    // Counted: 150 g and 3.5 g at 100 kcal per 100 g.
    expect(screen.getByRole('row', { name: new RegExp(`^${en.nutrient.kcal}`) })).toHaveTextContent(
      '154 kcal',
    );
    expect(within(entry.closest('li')!).queryByRole('button')).not.toBeInTheDocument();

    online = true;
    act(() => void window.dispatchEvent(new Event('online')));
    await vi.waitFor(() => expect(screen.queryByText(en.today.pending)).not.toBeInTheDocument());
    expect(await outbox.all()).toEqual([]);
    // The same request both times: no duplicate (M4-6).
    expect(saveMeal.mock.calls[1]![0]).toEqual(saveMeal.mock.calls[0]![0]);
    expect(today.mock.calls.length).toBeGreaterThan(1);
  });

  it('M5-9: online, a save is sent at once and nothing is left pending', async () => {
    const outbox = indexedDbOutbox(new IDBFactory());
    renderWithOutbox(fakeApi(undefined, { today: todayNow }), outbox, atSummary);
    fireEvent.click(await screen.findByRole('button', { name: en.summary.save }));
    await screen.findByText(en.saved.title);
    expect(screen.queryByText(en.saved.pending)).not.toBeInTheDocument();
    expect(await outbox.all()).toEqual([]);
  });

  it('M5-9: meals left from before are sent when the app starts', async () => {
    const outbox = indexedDbOutbox(new IDBFactory());
    await outbox.add(outboxItem(1));
    const saveMeal = vi.fn<Api['saveMeal']>((r) => Promise.resolve(stored(r)));
    renderWithOutbox(fakeApi(saveMeal, { today: todayNow }), outbox);
    await vi.waitFor(() => expect(saveMeal).toHaveBeenCalledWith(outboxItem(1).request));
    await vi.waitFor(async () => expect(await outbox.all()).toEqual([]));
  });

  it('M5-9, M4-2: a meal waiting for a session is sent after logging in', async () => {
    let session = false;
    const saveMeal = vi.fn<Api['saveMeal']>((r) =>
      session ? Promise.resolve(stored(r)) : Promise.reject(new ApiError(401)),
    );
    const outbox = indexedDbOutbox(new IDBFactory());
    await outbox.add(outboxItem(1));
    renderWithOutbox(
      fakeApi(saveMeal, {
        today: todayNow,
        login: () => {
          session = true;
          return Promise.resolve('ok');
        },
      }),
      outbox,
    );
    const dialog = await screen.findByRole('dialog', { name: en.login.title });
    fireEvent.change(within(dialog).getByLabelText(en.login.username), {
      target: { value: 'mlewand' },
    });
    fireEvent.change(within(dialog).getByLabelText(en.login.password), {
      target: { value: 'the password' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.login.submit }));
    await vi.waitFor(async () => expect(await outbox.all()).toEqual([]));
    expect(saveMeal).toHaveBeenCalledTimes(2);
  });

  it('M5-9: a meal the server refuses while Save waits is reported as not saved, and kept in Today (regression: #41)', async () => {
    const outbox = indexedDbOutbox(new IDBFactory());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const drafts = renderWithOutbox(
      fakeApi(() => Promise.reject(new ApiError(409)), { today: todayNow }),
      outbox,
      atSummary,
    );
    fireEvent.click(await screen.findByRole('button', { name: en.summary.save }));
    // Not "Meal saved", and not stuck on a frozen summary either.
    expect(await screen.findByRole('status')).toHaveTextContent(en.saved.refusedTitle);
    expect(screen.getByText(en.saved.refused)).toBeInTheDocument();
    expect(drafts.kept()).toBeUndefined();
    // The meal is kept on the device, listed as not saved, until removed.
    expect(await outbox.all()).toEqual([expect.objectContaining({ refused: 409 })]);
    click(en.saved.done);
    expect(await screen.findByRole('region', { name: en.today.refusedTitle })).toBeInTheDocument();
    warn.mockRestore();
  });

  it('M5-9: meals sent at startup show in Today once the server has them (regression: #41)', async () => {
    const outbox = indexedDbOutbox(new IDBFactory());
    await outbox.add(outboxItem(1, new Date().toISOString()));
    let accept!: () => void;
    const saveMeal = vi.fn<Api['saveMeal']>(
      (r) => new Promise((resolve) => (accept = () => resolve(stored(r)))),
    );
    const today = vi.fn(todayNow);
    renderWithOutbox(fakeApi(saveMeal, { today }), outbox);
    // Pending while it's being sent...
    expect(await screen.findByText(en.today.pending)).toBeInTheDocument();
    await vi.waitFor(() => expect(saveMeal).toHaveBeenCalled());
    const loads = today.mock.calls.length;
    accept();
    // ...then Today loads again, from the server that has it now.
    await vi.waitFor(() => expect(today.mock.calls.length).toBeGreaterThan(loads));
    expect(screen.queryByText(en.today.pending)).not.toBeInTheDocument();
  });

  it("M5-9: another user's waiting meals never show, also right after a switch (regression: #41)", async () => {
    onFixtureDay();
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const outbox = indexedDbOutbox(new IDBFactory());
      await outbox.add({ ...outboxItem(1), username: 'mlewand' });
      renderWithOutbox(
        fakeApi(() => Promise.reject(new TypeError('offline')), {
          today: () => Promise.reject(new TypeError('offline')),
        }),
        outbox,
      );
      expect(await screen.findByText(en.today.pending)).toBeInTheDocument();
      localStorage.setItem('macrofill.user', 'other');
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'macrofill.user', newValue: 'other' }),
        );
      });
      expect(screen.queryByText(en.today.pending)).not.toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-9: a meal refused in the background stays on the device, shown as not saved, until removed (regression: #41)', async () => {
    const outbox = indexedDbOutbox(new IDBFactory());
    await outbox.add(outboxItem(1, new Date().toISOString()));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    renderWithOutbox(
      fakeApi(() => Promise.reject(new ApiError(400)), { today: todayNow }),
      outbox,
    );
    const section = await screen.findByRole('region', { name: en.today.refusedTitle });
    expect(within(section).getByRole('alert')).toHaveTextContent(en.today.refusedHint);
    expect(await outbox.all()).toHaveLength(1);
    // Not counted: it isn't in the day.
    expect(screen.queryByText(en.today.pending)).not.toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: en.today.remove }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('region', { name: en.today.refusedTitle })).not.toBeInTheDocument(),
    );
    expect(await outbox.all()).toEqual([]);
    warn.mockRestore();
  });

  it("M5-9: a login in another tab sends that user's waiting meals (regression: #41)", async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const outbox = indexedDbOutbox(new IDBFactory());
      await outbox.add({ ...outboxItem(1), username: 'other' });
      const saveMeal = vi.fn<Api['saveMeal']>((r) => Promise.resolve(stored(r)));
      renderWithOutbox(
        fakeApi(saveMeal, {
          today: todayNow,
          me: () => Promise.resolve(localStorage.getItem('macrofill.user') ?? 'mlewand'),
        }),
        outbox,
      );
      await screen.findByRole('button', { name: en.home.logMeal });
      expect(saveMeal).not.toHaveBeenCalled();
      localStorage.setItem('macrofill.user', 'other');
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'macrofill.user', newValue: 'other' }),
        );
      });
      await vi.waitFor(() => expect(saveMeal).toHaveBeenCalledWith(outboxItem(1).request));
    } finally {
      localStorage.clear();
    }
  });

  it('M5-9: when the server names a different user at start, their waiting meals are sent (regression: #41)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const outbox = indexedDbOutbox(new IDBFactory());
      await outbox.add({ ...outboxItem(1), username: 'other' });
      const saveMeal = vi.fn<Api['saveMeal']>((r) => Promise.resolve(stored(r)));
      renderWithOutbox(
        fakeApi(saveMeal, { today: todayNow, me: () => Promise.resolve('other') }),
        outbox,
      );
      await vi.waitFor(() => expect(saveMeal).toHaveBeenCalledWith(outboxItem(1).request));
    } finally {
      localStorage.clear();
    }
  });

  it('M5-9: nothing waiting on the device shows before the user is known (regression: #41)', async () => {
    localStorage.clear();
    const outbox = indexedDbOutbox(new IDBFactory());
    await outbox.add({ ...outboxItem(1), username: 'other' });
    let answer!: (username: string) => void;
    renderWithOutbox(
      fakeApi(() => Promise.reject(new TypeError('offline')), {
        today: () => Promise.reject(new TypeError('offline')),
        me: () => new Promise<string>((resolve) => (answer = resolve)),
      }),
      outbox,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(en.today.pending)).not.toBeInTheDocument();
    act(() => answer('mlewand'));
    // Known now, and it's someone else's meal: still not shown.
    expect(await screen.findByText(en.today.loadFailed)).toBeInTheDocument();
    expect(screen.queryByText(en.today.pending)).not.toBeInTheDocument();
    localStorage.clear();
  });

  it("M5-9: if the user can't be learned, no one's waiting meals show (regression: #41)", async () => {
    localStorage.clear();
    const outbox = indexedDbOutbox(new IDBFactory());
    await outbox.add({ ...outboxItem(1), username: 'other' });
    renderWithOutbox(
      fakeApi(() => Promise.reject(new TypeError('offline')), {
        today: () => Promise.reject(new TypeError('offline')),
        me: () => Promise.reject(new TypeError('offline')),
      }),
      outbox,
    );
    expect(await screen.findByText(en.home.userUnknown)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(en.today.pending)).not.toBeInTheDocument();
    expect(screen.queryByText(en.today.pendingTitle)).not.toBeInTheDocument();
  });

  it("M5-9: a refused meal's time is shown in the user's timezone (regression: #41)", async () => {
    const outbox = indexedDbOutbox(new IDBFactory());
    // 07:00 UTC: 08:00 in Warsaw, the user's timezone; 23:00 the day before on this device.
    await outbox.add({ ...outboxItem(1, '2026-01-15T07:00:00.000Z'), refused: 400 });
    renderWithOutbox(fakeApi(undefined, { today: todayNow }), outbox);
    const section = await screen.findByRole('region', { name: en.today.refusedTitle });
    expect(within(section).getByText(/08:00/)).toBeInTheDocument();
  });

  it('M5-9: a meal with no owner is not put in the outbox (regression: #41)', async () => {
    const outbox = indexedDbOutbox(new IDBFactory());
    let save!: ReturnType<typeof useSaveMeal>;
    function Grab() {
      save = useSaveMeal();
      return null;
    }
    render(
      <ApiContext value={fakeApi()}>
        <OutboxStoreContext value={outbox}>
          <OutboxProvider>
            <Grab />
          </OutboxProvider>
        </OutboxStoreContext>
      </ApiContext>,
    );
    const { request, entry } = outboxItem(1);
    delete request.username;
    await expect(save(request, entry)).rejects.toThrow(/owner/);
    expect(await outbox.all()).toEqual([]);
  });

  it("M5-9: a remembered user's waiting meals don't show before the server confirms them (regression: #41)", async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const outbox = indexedDbOutbox(new IDBFactory());
      await outbox.add(outboxItem(1, new Date().toISOString()));
      let answer!: (username: string) => void;
      renderWithOutbox(
        fakeApi(() => Promise.reject(new TypeError('offline')), {
          today: todayNow,
          me: () => new Promise<string>((resolve) => (answer = resolve)),
        }),
        outbox,
      );
      await screen.findByRole('button', { name: en.home.logMeal });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByText(en.today.pending)).not.toBeInTheDocument();
      // The session is someone else's: still not shown.
      act(() => answer('other'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByText(en.today.pending)).not.toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-9: offline, the waiting meals show newest first (regression: #41)', async () => {
    onFixtureDay();
    const outbox = indexedDbOutbox(new IDBFactory());
    await outbox.add(outboxItem(1, '2026-01-15T07:00:00.000Z'));
    await outbox.add(outboxItem(2, '2026-01-15T07:20:00.000Z'));
    renderWithOutbox(
      fakeApi(() => Promise.reject(new TypeError('offline')), {
        today: () => Promise.reject(new TypeError('offline')),
      }),
      outbox,
    );
    await screen.findByText(en.today.pendingTitle);
    const times = screen.getAllByRole('listitem').map((li) => li.querySelector('time')?.dateTime);
    expect(times).toEqual(['2026-01-15T07:20:00.000Z', '2026-01-15T07:00:00.000Z']);
  });

  it("M5-9: if the server can't confirm the remembered user, their meals stay out of the server's day (regression: #41)", async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const outbox = indexedDbOutbox(new IDBFactory());
      await outbox.add(outboxItem(1, new Date().toISOString()));
      const today = vi.fn(todayNow);
      renderWithOutbox(
        fakeApi(() => Promise.reject(new TypeError('offline')), {
          today,
          me: () => Promise.reject(new TypeError('timeout')),
        }),
        outbox,
      );
      await screen.findByRole('heading', { name: en.today.title });
      await new Promise((resolve) => setTimeout(resolve, 50));
      // No server day to mix them into: it isn't even asked for (M4-1). They're listed on their own.
      expect(today).not.toHaveBeenCalled();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-9: offline, with the user remembered, what waits on the device still shows', async () => {
    onFixtureDay();
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const outbox = indexedDbOutbox(new IDBFactory());
      await outbox.add(outboxItem(1));
      renderWithOutbox(
        fakeApi(() => Promise.reject(new TypeError('offline')), {
          today: () => Promise.reject(new TypeError('offline')),
          me: () => Promise.reject(new TypeError('offline')),
        }),
        outbox,
      );
      expect(await screen.findByText(en.today.pendingTitle)).toBeInTheDocument();
      expect(screen.getByText(en.today.pending)).toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-9: waiting meals are sent only once the server has confirmed the user (regression: #41)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const outbox = indexedDbOutbox(new IDBFactory());
      await outbox.add(outboxItem(1));
      let answer!: (username: string) => void;
      const saveMeal = vi.fn<Api['saveMeal']>((r) => Promise.resolve(stored(r)));
      renderWithOutbox(
        fakeApi(saveMeal, {
          today: todayNow,
          me: () => new Promise<string>((resolve) => (answer = resolve)),
        }),
        outbox,
      );
      await screen.findByRole('button', { name: en.home.logMeal });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(saveMeal).not.toHaveBeenCalled();
      act(() => answer('mlewand'));
      await vi.waitFor(() => expect(saveMeal).toHaveBeenCalledWith(outboxItem(1).request));
    } finally {
      localStorage.clear();
    }
  });

  it('M5-8: a session kept while another tab blocks the database resumes once it lets go (regression: #41)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const factory = new IDBFactory();
      // An older version of the app, open in another tab, that kept a session.
      const old = await new Promise<IDBDatabase>((resolve) => {
        const open = factory.open('macrofill', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('drafts');
        open.onsuccess = () => resolve(open.result);
      });
      await new Promise<void>((resolve) => {
        const put = old
          .transaction('drafts', 'readwrite')
          .objectStore('drafts')
          .put({ state: draftAtMilk, username: 'mlewand' }, 'directEntry');
        put.onsuccess = () => resolve();
      });
      render(
        <ApiContext value={fakeApi()}>
          <DraftContext value={indexedDbDraftStore(factory)}>
            <App />
          </DraftContext>
        </ApiContext>,
      );
      expect(await screen.findByText(en.app.blocked)).toBeInTheDocument();
      old.close();
      expect(await screen.findByText('Step 2 of 2', {}, { timeout: 4000 })).toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-9: back on the tab and offline, queued meals show again, without the earlier day (regression: #41)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const outbox = indexedDbOutbox(new IDBFactory());
      await outbox.add(outboxItem(1, new Date().toISOString()));
      const me = vi
        .fn<Api['me']>()
        .mockResolvedValueOnce('mlewand')
        .mockRejectedValue(new TypeError('offline'));
      renderWithOutbox(
        fakeApi(() => Promise.reject(new TypeError('offline')), { today: todayNow, me }),
        outbox,
      );
      expect(await screen.findByText(en.today.pending)).toBeInTheDocument();
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await vi.waitFor(() => expect(me).toHaveBeenCalledTimes(2));
      // Offline: the remembered user's queued meals, on their own.
      expect(await screen.findByText(en.today.pendingTitle)).toBeInTheDocument();
      expect(screen.getByText(en.today.pending)).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it('M7-1: the timezone is kept for the user Today was asked for, not one who logged in meanwhile (regression: #41)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      let answer!: (today: Today) => void;
      const today = vi.fn(() => new Promise<Today>((resolve) => (answer = resolve)));
      renderWithOutbox(fakeApi(undefined, { today }), indexedDbOutbox(new IDBFactory()));
      await vi.waitFor(() => expect(today).toHaveBeenCalled());
      // Another tab logs in as someone else; this tab hasn't seen the storage event yet.
      localStorage.setItem('macrofill.user', 'other');
      await act(async () => {
        answer({ ...emptyToday, day: localDay(new Date(), emptyToday.timezone) });
        await Promise.resolve();
      });
      expect(localStorage.getItem('macrofill.timezone:other')).toBeNull();
    } finally {
      localStorage.clear();
    }
  });

  it('M4-1: coming back to the tab hides the day loaded before until the server confirms the user (regression: #41)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const me = vi
        .fn<Api['me']>()
        .mockResolvedValueOnce('mlewand')
        .mockImplementation(() => new Promise<string>(() => undefined));
      renderWithOutbox(
        fakeApi(undefined, { today: todayNow, me }),
        indexedDbOutbox(new IDBFactory()),
      );
      expect(await screen.findByRole('table')).toBeInTheDocument();
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await vi.waitFor(() => expect(me).toHaveBeenCalledTimes(2));
      // Another tab may have logged in as someone else: nothing of the earlier day shows meanwhile.
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.getByText(en.app.loading)).toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it("M7-1: offline, only today's queued meals are listed under Today (regression: #41)", async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const outbox = indexedDbOutbox(new IDBFactory());
      const now = Date.now();
      await outbox.add(outboxItem(1, new Date(now).toISOString()));
      await outbox.add(outboxItem(2, new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString()));
      renderWithOutbox(
        fakeApi(() => Promise.reject(new TypeError('offline')), {
          today: () => Promise.reject(new TypeError('offline')),
          me: () => Promise.reject(new TypeError('offline')),
        }),
        outbox,
      );
      await screen.findByText(en.today.pendingTitle);
      expect(screen.getAllByText(en.today.pending)).toHaveLength(1);
    } finally {
      localStorage.clear();
    }
  });

  it('M7-1: after a failed load, Today shows the day once a re-check loads it (regression: #41)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const today = vi
        .fn<Api['today']>()
        .mockRejectedValueOnce(new TypeError('offline'))
        .mockImplementation(todayNow);
      renderWithOutbox(fakeApi(undefined, { today }), indexedDbOutbox(new IDBFactory()));
      expect(await screen.findByText(en.today.loadFailed)).toBeInTheDocument();
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(screen.queryByText(en.today.loadFailed)).not.toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-9: a user change in another tab, after an offline check, lists nothing until the server answers (regression: #41)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const outbox = indexedDbOutbox(new IDBFactory());
      await outbox.add({ ...outboxItem(1, new Date().toISOString()), username: 'other' });
      const me = vi
        .fn<Api['me']>()
        .mockRejectedValueOnce(new TypeError('offline'))
        .mockImplementation(() => new Promise<string>(() => undefined));
      renderWithOutbox(
        fakeApi(() => Promise.reject(new TypeError('offline')), {
          today: () => Promise.reject(new TypeError('offline')),
          me,
        }),
        outbox,
      );
      expect(await screen.findByText(en.today.loadFailed)).toBeInTheDocument();
      localStorage.setItem('macrofill.user', 'other');
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: 'macrofill.user',
            oldValue: 'mlewand',
            newValue: 'other',
          }),
        );
      });
      await vi.waitFor(() => expect(me).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByText(en.today.pending)).not.toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-9: coming back to the tab hides queued meals until the server confirms the user again (regression: #41)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const outbox = indexedDbOutbox(new IDBFactory());
      await outbox.add(outboxItem(1, new Date().toISOString()));
      const me = vi
        .fn<Api['me']>()
        .mockResolvedValueOnce('mlewand')
        .mockImplementation(() => new Promise<string>(() => undefined));
      renderWithOutbox(
        fakeApi(() => Promise.reject(new TypeError('offline')), { today: todayNow, me }),
        outbox,
      );
      // Confirmed: the queued meal is in the day.
      expect(await screen.findByText(en.today.pending)).toBeInTheDocument();
      // Another tab may have logged in as someone else, with no storage event; back on this tab:
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await vi.waitFor(() => expect(me).toHaveBeenCalledTimes(2));
      // Until the server answers again, it's out of the day.
      expect(screen.queryByText(en.today.pending)).not.toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it("M5-9: offline, queued meals show in the user's timezone from the last time Today loaded (regression: #41)", async () => {
    onFixtureDay();
    localStorage.setItem('macrofill.timezone:mlewand', 'Europe/Warsaw');
    try {
      const outbox = indexedDbOutbox(new IDBFactory());
      // 07:00 UTC: 08:00 in Warsaw; 23:00 the day before on this device (Los Angeles).
      await outbox.add(outboxItem(1, '2026-01-15T07:00:00.000Z'));
      renderWithOutbox(
        fakeApi(() => Promise.reject(new TypeError('offline')), {
          today: () => Promise.reject(new TypeError('offline')),
        }),
        outbox,
      );
      await screen.findByText(en.today.pendingTitle);
      expect(screen.getByText(/08:00/)).toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it("M5-9: offline, another user's remembered timezone is not used (regression: #41)", async () => {
    onFixtureDay();
    localStorage.clear();
    try {
      // Someone else used Today on this device (Warsaw)...
      renderWithOutbox(
        fakeApi(undefined, { today: todayNow, me: () => Promise.resolve('other') }),
        indexedDbOutbox(new IDBFactory()),
      );
      await screen.findByRole('heading', { name: en.today.title });
      await vi.waitFor(() =>
        expect(Object.keys(localStorage).some((k) => k.startsWith('macrofill.timezone'))).toBe(
          true,
        ),
      );
      cleanup();
      // ...then this user, offline, who never loaded Today here.
      const outbox = indexedDbOutbox(new IDBFactory());
      // 07:00 UTC: 23:00 the day before on this device (Los Angeles), 08:00 in Warsaw.
      await outbox.add(outboxItem(1, '2026-01-15T07:00:00.000Z'));
      renderWithOutbox(
        fakeApi(() => Promise.reject(new TypeError('offline')), {
          today: () => Promise.reject(new TypeError('offline')),
        }),
        outbox,
      );
      await screen.findByText(en.today.pendingTitle);
      expect(screen.getByText(/23:00/)).toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it('M4-1: Today shows no server day until the server confirms the user (regression: #41)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      // /api/me gets no answer in time, while the cookie may be someone else's now.
      const me = vi
        .fn<Api['me']>()
        .mockRejectedValueOnce(new TypeError('offline'))
        .mockResolvedValue('mlewand');
      const today = vi.fn(todayNow);
      renderWithOutbox(fakeApi(undefined, { today, me }), indexedDbOutbox(new IDBFactory()));
      expect(await screen.findByText(en.today.loadFailed)).toBeInTheDocument();
      expect(today).not.toHaveBeenCalled();
      // Try again asks who's logged in first; then the day loads.
      fireEvent.click(screen.getAllByRole('button', { name: en.app.retry }).at(-1)!);
      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(me).toHaveBeenCalledTimes(2);
      expect(today).toHaveBeenCalledTimes(1);
    } finally {
      localStorage.clear();
    }
  });

  it("M4-1: while the server is being asked who's logged in, Today loads nothing (regression: #41)", async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const me = vi.fn<Api['me']>(() => new Promise<string>(() => undefined));
      const today = vi.fn(todayNow);
      renderWithOutbox(fakeApi(undefined, { today, me }), indexedDbOutbox(new IDBFactory()));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(today).not.toHaveBeenCalled();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-9: a server error from /api/me counts as unreachable: Today offers Try again (regression: #41)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const me = vi
        .fn<Api['me']>()
        .mockRejectedValueOnce(new ApiError(503))
        .mockResolvedValue('mlewand');
      const today = vi.fn(todayNow);
      renderWithOutbox(fakeApi(undefined, { today, me }), indexedDbOutbox(new IDBFactory()));
      expect(await screen.findByText(en.today.loadFailed)).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole('button', { name: en.app.retry }).at(-1)!);
      expect(await screen.findByRole('table')).toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-9: Today remembers the user timezone for when it is offline', async () => {
    localStorage.clear();
    const outbox = indexedDbOutbox(new IDBFactory());
    renderWithOutbox(fakeApi(undefined, { today: todayNow }), outbox);
    await screen.findByRole('heading', { name: en.today.title });
    await vi.waitFor(() =>
      expect(localStorage.getItem('macrofill.timezone:mlewand')).toBe('Europe/Warsaw'),
    );
    localStorage.clear();
  });

  it("M5-9: while the server is being asked who's logged in, Today's offline view lists nothing (regression: #41)", async () => {
    onFixtureDay();
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const outbox = indexedDbOutbox(new IDBFactory());
      await outbox.add(outboxItem(1));
      let refuse!: () => void;
      renderWithOutbox(
        fakeApi(() => Promise.reject(new TypeError('offline')), {
          today: () => Promise.reject(new TypeError('offline')),
          me: () =>
            new Promise<string>((_, reject) => (refuse = () => reject(new TypeError('offline')))),
        }),
        outbox,
      );
      expect(await screen.findByText(en.app.loading)).toBeInTheDocument();
      expect(screen.queryByText(en.today.pending)).not.toBeInTheDocument();
      // The server can't be reached: offline, the remembered user's list shows.
      act(() => refuse());
      expect(await screen.findByText(en.today.pending)).toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  it('M5-9: a user change seen in another tab sends nothing until the server confirms it (regression: #41)', async () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    try {
      const outbox = indexedDbOutbox(new IDBFactory());
      await outbox.add({ ...outboxItem(1), username: 'other' });
      let confirm!: (username: string) => void;
      const me = vi
        .fn<Api['me']>()
        .mockResolvedValueOnce('mlewand')
        .mockImplementation(() => new Promise<string>((resolve) => (confirm = resolve)));
      const saveMeal = vi.fn<Api['saveMeal']>((r) => Promise.resolve(stored(r)));
      renderWithOutbox(fakeApi(saveMeal, { today: todayNow, me }), outbox);
      await screen.findByRole('button', { name: en.home.logMeal });
      localStorage.setItem('macrofill.user', 'other');
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'macrofill.user', newValue: 'other' }),
        );
      });
      await vi.waitFor(() => expect(me).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(saveMeal).not.toHaveBeenCalled();
      act(() => confirm('other'));
      await vi.waitFor(() => expect(saveMeal).toHaveBeenCalledWith(outboxItem(1).request));
    } finally {
      localStorage.clear();
    }
  });

  it('M5-9: offline, Today still lists what waits on the device', async () => {
    onFixtureDay();
    const outbox = indexedDbOutbox(new IDBFactory());
    await outbox.add(outboxItem(1));
    renderWithOutbox(
      fakeApi(() => Promise.reject(new TypeError('offline')), {
        today: () => Promise.reject(new TypeError('offline')),
      }),
      outbox,
    );
    expect(await screen.findByText(en.today.loadFailed)).toBeInTheDocument();
    expect(await screen.findByText(en.today.pendingTitle)).toBeInTheDocument();
    expect(screen.getByText(en.today.pending)).toBeInTheDocument();
  });
});
