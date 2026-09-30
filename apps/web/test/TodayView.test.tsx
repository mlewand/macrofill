import type { NutritionValues, Today } from '@macrofill/domain';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext, type Api } from '../src/api/api';
import { App } from '../src/App';
import en from '../src/i18n/en.json';
import { emptyToday, fakeApi } from './support/api';

const nutrition = (values: Partial<NutritionValues>): NutritionValues => ({
  kcal: 0,
  fat: 0,
  saturates: 0,
  carbs: 0,
  sugars: 0,
  protein: 0,
  salt: 0,
  fibre: 0,
  ...values,
});

const lunch = {
  id: 'c8f4d2b3-5e6a-4f7b-8c9d-8e7f6a5b4c3d',
  preparedMealId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
  // 22:30 UTC is 23:30 in Warsaw (UTC+1 in January).
  eatenAt: '2026-01-15T22:30:00.000Z',
  recipeName: null,
  nutrition: nutrition({ kcal: 150.4, protein: 7.5, fat: 8, carbs: 11.75, fibre: null }),
};
const breakfast = {
  id: 'f1c7a5e6-8b9d-4c0e-9f1a-1b0c9d8e7f6a',
  preparedMealId: 'a2d8b6f7-9c0e-4d1f-8a2b-2c1d0e9f8a7b',
  eatenAt: '2026-01-15T06:05:00.000Z',
  recipeName: { en: 'Curd' },
  nutrition: nutrition({ kcal: 2700, protein: 34, fat: 8.4, carbs: 6.8, fibre: null }),
};

const day: Today = {
  ...emptyToday,
  targets: { protein: 160, fat: 65, carbs: null, fibre: 30, kcal: 2700 },
  totals: nutrition({ kcal: 2850.4, protein: 41.5, fat: 16.4, carbs: 18.55, fibre: null }),
  entries: [lunch, breakfast],
};

function renderApp(api: Api) {
  render(
    <ApiContext value={api}>
      <App />
    </ApiContext>,
  );
}

const progressRow = (nutrient: string) =>
  within(screen.getByRole('table')).getByRole('row', { name: new RegExp(`^${nutrient}`) });
const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((c) => c.textContent);

describe('Today view', () => {
  it("M7-1: lists the day's entries newest first, with recipe name, time in the user's timezone and macros", async () => {
    renderApp(fakeApi({ today: () => Promise.resolve(day) }));
    const entries = await screen.findAllByRole('listitem');
    expect(entries.map((e) => within(e).getByRole('strong', { hidden: true }).textContent)).toEqual(
      [en.today.meal, 'Curd'],
    );
    // The tests run in Los Angeles time (vitest.config.ts); the times are Warsaw's.
    expect(within(entries[0]!).getByText('23:30')).toBeInTheDocument();
    expect(within(entries[1]!).getByText('07:05')).toBeInTheDocument();
    expect(entries[1]).toHaveTextContent('Energy 2,700 kcal');
    expect(entries[1]).toHaveTextContent('Protein 34 g');
    expect(entries[0]).toHaveTextContent('Carbs 11.8 g');
  });

  it('M7-2: shows consumed, target and remaining; a nutrient without a target only consumed', async () => {
    renderApp(fakeApi({ today: () => Promise.resolve(day) }));
    await screen.findByRole('table');
    expect(cells(progressRow('Protein'))).toEqual(['41.5 g', '160 g', '118.5 g']);
    expect(cells(progressRow('Carbs'))).toEqual(['18.6 g', '', '']);
    // Over the target: remaining goes negative.
    expect(cells(progressRow('Energy'))).toEqual(['2,850 kcal', '2,700 kcal', '-150 kcal']);
  });

  it('M7-3: unknown fibre shows as "unknown", and so does its remaining', async () => {
    renderApp(fakeApi({ today: () => Promise.resolve(day) }));
    await screen.findByRole('table');
    expect(cells(progressRow('Fibre'))).toEqual([en.unknown, '30 g', en.unknown]);
  });

  it('shows an empty day', async () => {
    renderApp(fakeApi());
    expect(await screen.findByText(en.today.empty)).toBeInTheDocument();
  });

  it('M7-4: deleting asks for confirmation first; Keep cancels', async () => {
    const api = fakeApi({ today: () => Promise.resolve(day) });
    renderApp(api);
    fireEvent.click(await screen.findByRole('button', { name: `Delete Curd eaten at 07:05` }));
    const confirm = screen.getByRole('group', { name: en.today.confirmDelete });
    fireEvent.click(within(confirm).getByRole('button', { name: en.today.keep }));
    expect(api.deleteEntry).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: en.today.confirmDelete })).not.toBeInTheDocument();
  });

  it('M7-4: confirming deletes the entry and reloads the day', async () => {
    let current = day;
    const api = fakeApi({
      today: () => Promise.resolve(current),
      deleteEntry: (id) => {
        current = { ...day, entries: day.entries.filter((e) => e.id !== id) };
        return Promise.resolve();
      },
    });
    renderApp(api);
    fireEvent.click(await screen.findByRole('button', { name: `Delete Curd eaten at 07:05` }));
    fireEvent.click(screen.getByRole('button', { name: en.today.confirm }));
    expect(api.deleteEntry).toHaveBeenCalledWith(breakfast.id);
    await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(screen.queryByText('Curd')).not.toBeInTheDocument();
  });

  it('M7-4: a failed delete says so and keeps the entry', async () => {
    renderApp(
      fakeApi({
        today: () => Promise.resolve(day),
        deleteEntry: () => Promise.reject(new Error('offline')),
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: `Delete Curd eaten at 07:05` }));
    fireEvent.click(screen.getByRole('button', { name: en.today.confirm }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.today.deleteFailed);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('M5-7: a saved meal appears in the Today view', async () => {
    let current = emptyToday;
    const catalog = {
      ingredientClasses: [{ id: 'curd', name: { en: 'Curd' } }],
      recipes: [{ id: breakfast.preparedMealId, name: { en: 'Curd' }, steps: [] }],
      products: [],
    };
    const api = fakeApi({
      catalog: () => Promise.resolve(catalog),
      today: () => Promise.resolve(current),
      saveMeal: (request) => {
        current = { ...emptyToday, entries: [{ ...breakfast, id: request.consumptionEntry.id }] };
        return Promise.resolve({
          meal: request.meal,
          consumptionEntry: { ...request.consumptionEntry, preparedMealId: request.meal.id },
        });
      },
    });
    renderApp(api);
    expect(await screen.findByText(en.today.empty)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.home.logMeal }));
    fireEvent.click(await screen.findByRole('button', { name: 'Curd' }));
    fireEvent.click(screen.getByRole('button', { name: en.summary.save }));
    fireEvent.click(await screen.findByRole('button', { name: en.saved.done }));
    expect(await screen.findByText('Curd')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});
