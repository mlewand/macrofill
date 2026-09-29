import type { Catalog, SaveMealRequest, SaveMealResponse } from '@macrofill/domain';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext, type Api } from '../src/api/api';
import { App } from '../src/App';
import en from '../src/i18n/en.json';

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

function fakeApi(saveMeal: Api['saveMeal'] = (request) => Promise.resolve(stored(request))): Api {
  return { catalog: vi.fn(() => Promise.resolve(catalog)), saveMeal: vi.fn(saveMeal) };
}

const stored = (request: SaveMealRequest): SaveMealResponse => ({
  meal: request.meal,
  consumptionEntry: { ...request.consumptionEntry, preparedMealId: request.meal.id },
});

function renderApp(api = fakeApi()) {
  render(
    <ApiContext value={api}>
      <App />
    </ApiContext>,
  );
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
  const used = renderApp(api);
  click(en.home.logMeal);
  fireEvent.click(await screen.findByRole('button', { name: 'Curd bowl' }));
  return used;
}

describe('Direct Entry', () => {
  it('M5-1: the user picks a recipe from the seeded list', async () => {
    renderApp();
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
});
