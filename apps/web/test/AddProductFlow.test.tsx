import type { Catalog, SaveMealRequest } from '@macrofill/domain';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiContext, type Api } from '../src/api/api';
import { App } from '../src/App';
import en from '../src/i18n/en.json';
import { rememberUser } from '../src/session';
import { fakeApi } from './support/api';

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
        { id: 'a6b75d73-d68a-4eec-8219-5a16aeb9917e', ingredientClassId: 'curd' },
        { id: 'b48924bb-4fa3-4843-b727-6928f03636d0', ingredientClassId: 'milk' },
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
  ],
};

const f = en.product.field;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const radios = () =>
  within(screen.getByRole('group', { name: en.step.product })).getAllByRole('radio');
const checked = () =>
  radios()
    .filter((r) => (r as HTMLInputElement).checked)
    .map((r) => r.closest('label')?.textContent ?? '');
const options = () => radios().map((r) => r.closest('label')?.textContent ?? '');

/** The app at the first step (curd) of the Curd bowl in Direct Entry. */
async function atFirstStep(api: Api = fakeApi({ catalog: () => Promise.resolve(catalog) })) {
  render(
    <ApiContext value={api}>
      <App />
    </ApiContext>,
  );
  fireEvent.click(await screen.findByRole('button', { name: en.home.logMeal }));
  fireEvent.click(await screen.findByRole('button', { name: 'Curd bowl' }));
  return api;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  rememberUser('mlewand');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('adding a product at a step (Direct Entry)', () => {
  it('#64-4, #64-6: the new product is selected for the step and listed without reloading, on the same step', async () => {
    const api = await atFirstStep();
    type(en.step.grams, '200');
    click(en.step.addProduct);
    expect(screen.getByRole('dialog', { name: en.product.title })).toBeVisible();
    type(en.product.name, 'Homemade curd');
    type(f.protein, '17');
    click(en.product.save);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(options()).toEqual(['Homemade curd', 'Polmlek Twaróg']);
    expect(checked()).toEqual(['Homemade curd']);
    // Saving the product is not Next: still the first step, with what was typed.
    expect(screen.getByText('Step 1 of 2')).toBeVisible();
    expect(screen.getByLabelText(en.step.grams)).toHaveValue('200');
    expect(api.catalog).toHaveBeenCalledTimes(1);
    expect(api.createProduct).toHaveBeenCalledOnce();
  });

  it('#64-1: the form opens with the step’s ingredient class', async () => {
    await atFirstStep();
    click(en.step.addProduct);
    expect(screen.getByLabelText(en.product.ingredientClass)).toHaveValue('curd');
  });

  it('#64-6: Enter in the form saves the product and does not move the step on', async () => {
    await atFirstStep();
    type(en.step.grams, '200');
    click(en.step.addProduct);
    type(en.product.name, 'Homemade curd');
    fireEvent.submit(screen.getByLabelText(en.product.name));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Step 1 of 2')).toBeVisible();
  });

  it('#64-6: Cancel closes the form and changes nothing', async () => {
    const api = await atFirstStep();
    click(en.step.addProduct);
    click(en.product.cancel);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(options()).toEqual(['Polmlek Twaróg']);
    expect(api.createProduct).not.toHaveBeenCalled();
  });

  it('#64-5: a product of another class is used for the step, and the picker says where it will appear', async () => {
    await atFirstStep();
    click(en.step.addProduct);
    type(en.product.name, 'Oat milk');
    fireEvent.change(screen.getByLabelText(en.product.ingredientClass), {
      target: { value: 'milk' },
    });
    click(en.product.save);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(checked()).toEqual(['Oat milk']);
    expect(
      screen.getByText(
        en.step.otherClass.replace('{{product}}', 'Oat milk').replaceAll('{{class}}', 'Milk'),
      ),
    ).toBeVisible();
    // It is the product of the step: the meal uses it.
    type(en.step.grams, '100');
    click(en.step.next);
    // And under its own class from now on: the next step is milk.
    expect(options()).toContain('Oat milk');
    expect(checked()).toEqual([]);
  });

  it('#64-5: choosing another product takes the notice away', async () => {
    await atFirstStep();
    click(en.step.addProduct);
    type(en.product.name, 'Oat milk');
    fireEvent.change(screen.getByLabelText(en.product.ingredientClass), {
      target: { value: 'milk' },
    });
    click(en.product.save);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByLabelText('Polmlek Twaróg'));
    expect(screen.queryByText(/Oat milk is a Milk product/)).toBeNull();
    expect(options()).toEqual(['Polmlek Twaróg']);
  });

  it('#64-6: the meal can be finished and saved with the new product', async () => {
    const saveMeal = vi.fn<Api['saveMeal']>((request: SaveMealRequest) =>
      Promise.resolve({
        meal: request.meal,
        consumptionEntry: { ...request.consumptionEntry, preparedMealId: request.meal.id },
      }),
    );
    const api = fakeApi({ catalog: () => Promise.resolve(catalog), saveMeal });
    await atFirstStep(api);
    click(en.step.addProduct);
    type(en.product.name, 'Homemade curd');
    type(f.protein, '17');
    click(en.product.save);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const added = vi.mocked(api.createProduct).mock.calls[0]![0];
    type(en.step.grams, '200');
    click(en.step.next);
    click(en.step.skip);
    click(en.summary.save);
    await screen.findByText(en.saved.title);
    const items = saveMeal.mock.calls[0]![0].meal.items;
    expect(items[0]).toMatchObject({ productId: added.id, grams: 200 });
  });

  it('#64-7: offline, the form says so; a product the app already has can still be picked', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const api = await atFirstStep();
    click(en.step.addProduct);
    expect(screen.getByRole('status')).toHaveTextContent(en.product.offline);
    expect(screen.getByRole('button', { name: en.product.save })).toBeDisabled();
    click(en.product.cancel);
    fireEvent.click(screen.getByLabelText('Polmlek Twaróg'));
    type(en.step.grams, '200');
    click(en.step.next);
    expect(screen.getByText('Step 2 of 2')).toBeVisible();
    expect(api.createProduct).not.toHaveBeenCalled();
  });
});
