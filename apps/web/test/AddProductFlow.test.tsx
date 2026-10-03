import type { Catalog, SaveMealRequest } from '@macrofill/domain';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiContext, ApiError, type Api } from '../src/api/api';
import { App } from '../src/App';
import en from '../src/i18n/en.json';
import { ScannerContext } from '../src/scanner';
import { rememberUser } from '../src/session';
import { DraftContext, indexedDbDraftStore } from '../src/storage/drafts';
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
async function atFirstStep(
  api: Api = fakeApi({ catalog: () => Promise.resolve(catalog) }),
  scanner: FakeScanner = fakeScanner(),
) {
  render(
    <ApiContext value={api}>
      <ScannerContext value={scanner}>
        <App />
      </ScannerContext>
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

  it('#64-5: the cross-class product is still selected after a reload of the page (regression: #73)', async () => {
    const api = fakeApi({ catalog: () => Promise.resolve(catalog) });
    const store = indexedDbDraftStore();
    const renderApp = () =>
      render(
        <ApiContext value={api}>
          <DraftContext value={store}>
            <App />
          </DraftContext>
        </ApiContext>,
      );
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: en.home.logMeal }));
    fireEvent.click(await screen.findByRole('button', { name: 'Curd bowl' }));
    click(en.step.addProduct);
    type(en.product.name, 'Oat milk');
    fireEvent.change(screen.getByLabelText(en.product.ingredientClass), {
      target: { value: 'milk' },
    });
    click(en.product.save);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(checked()).toEqual(['Oat milk']);
    // Kept once IndexedDB has it; then a reload: a new page, the same device.
    await waitFor(async () =>
      expect((await store.load())?.state.steps[0]?.productId).toBeDefined(),
    );
    cleanup();
    // The catalog now has the product, as the server's would after the save.
    const added = vi.mocked(api.createProduct).mock.calls[0]![0];
    vi.mocked(api.catalog).mockResolvedValue({
      ...catalog,
      products: [...catalog.products, { ...added, source: 'manual', lastUsedAt: null }],
    });
    renderApp();
    await screen.findByText('Step 1 of 2');
    expect(checked()).toEqual(['Oat milk']);
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

describe('scanning a barcode at a step', () => {
  const EAN13 = '5901234123457';
  const base = () => fakeApi({ catalog: () => Promise.resolve(catalog) });
  const cameraOn = (scanner: FakeScanner) => waitFor(() => expect(scanner.open).toBe(true));
  const milkOat = {
    id: '7a1f3d52-8c4e-4b6a-9d20-3e5f6a7b8c9d',
    ingredientClassId: 'milk',
    name: 'Oat milk',
    nutrition,
    source: 'manual' as const,
    lastUsedAt: null,
  };

  it('#65-6: the camera is not asked for until Scan barcode is tapped', async () => {
    const scanner = fakeScanner();
    await atFirstStep(base(), scanner);
    expect(scanner.start).not.toHaveBeenCalled();
    click(en.step.scan);
    await cameraOn(scanner);
    expect(scanner.start).toHaveBeenCalledOnce();
  });

  it('#65-3: a barcode the store knows selects its product for the step, on the same step', async () => {
    const api = fakeApi({
      catalog: () => Promise.resolve(catalog),
      productByBarcode: () => Promise.resolve(catalog.products[0]),
    });
    const scanner = fakeScanner();
    await atFirstStep(api, scanner);
    type(en.step.grams, '200');
    click(en.step.scan);
    await cameraOn(scanner);
    scanner.read(EAN13);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.productByBarcode).toHaveBeenCalledWith(EAN13);
    expect(checked()).toEqual(['Polmlek Twaróg']);
    expect(screen.getByText('Step 1 of 2')).toBeVisible();
    expect(screen.getByLabelText(en.step.grams)).toHaveValue('200');
    expect(scanner.open).toBe(false);
  });

  it('#65-2: the lookup gets the 13-digit form of a UPC-A code', async () => {
    const api = base();
    const scanner = fakeScanner();
    await atFirstStep(api, scanner);
    click(en.step.scan);
    await cameraOn(scanner);
    scanner.read('036000291452');
    await waitFor(() => expect(api.productByBarcode).toHaveBeenCalledWith('0036000291452'));
  });

  it('#65-3: a product somebody else added since the catalog loaded is listed and selected', async () => {
    const api = fakeApi({
      catalog: () => Promise.resolve(catalog),
      productByBarcode: () =>
        Promise.resolve({ ...catalog.products[0]!, id: milkOat.id, name: 'Fresh curd' }),
    });
    const scanner = fakeScanner();
    await atFirstStep(api, scanner);
    click(en.step.scan);
    await cameraOn(scanner);
    scanner.read(EAN13);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(options()).toEqual(['Fresh curd', 'Polmlek Twaróg']);
    expect(checked()).toEqual(['Fresh curd']);
  });

  it('#65-5: a product of another class is used for the step, with the notice, and Scan again is still there', async () => {
    const api = fakeApi({
      catalog: () => Promise.resolve(catalog),
      productByBarcode: () => Promise.resolve(milkOat),
    });
    const scanner = fakeScanner();
    await atFirstStep(api, scanner);
    click(en.step.scan);
    await cameraOn(scanner);
    scanner.read(EAN13);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(checked()).toEqual(['Oat milk']);
    expect(screen.getByText(/Oat milk is a Milk product/)).toBeVisible();
    expect(screen.getByRole('button', { name: en.step.scan })).toBeEnabled();
  });

  it('#65-4: an unknown barcode opens the product form with it, after the camera is off, and saves it with the product', async () => {
    const api = base();
    const scanner = fakeScanner();
    await atFirstStep(api, scanner);
    click(en.step.scan);
    await cameraOn(scanner);
    scanner.read(EAN13);
    const form = await screen.findByRole('dialog', { name: en.product.title });
    expect(screen.queryByRole('dialog', { name: en.scan.title })).toBeNull();
    expect(scanner.open).toBe(false);
    expect(within(form).getByText(en.product.barcode.replace('{{barcode}}', EAN13))).toBeVisible();
    type(en.product.name, 'Scanned curd');
    click(en.product.save);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(vi.mocked(api.createProduct).mock.calls[0]![0]).toMatchObject({
      name: 'Scanned curd',
      barcode: EAN13,
      ingredientClassId: 'curd',
    });
    expect(checked()).toEqual(['Scanned curd']);
  });

  it('#65-1, #65-4: typing the digits, where the browser cannot scan, works the same way', async () => {
    const api = base();
    await atFirstStep(api, fakeScanner({ supported: false }));
    click(en.step.scan);
    fireEvent.change(await screen.findByLabelText(en.scan.digits), { target: { value: EAN13 } });
    click(en.scan.useDigits);
    expect(await screen.findByRole('dialog', { name: en.product.title })).toBeVisible();
    expect(screen.getByText(en.product.barcode.replace('{{barcode}}', EAN13))).toBeVisible();
  });

  it('#65-3: when the store cannot be asked, the scan view stays, and no empty form opens', async () => {
    const api = fakeApi({
      catalog: () => Promise.resolve(catalog),
      productByBarcode: () => Promise.reject(new ApiError(500)),
    });
    const scanner = fakeScanner();
    await atFirstStep(api, scanner);
    click(en.step.scan);
    await cameraOn(scanner);
    scanner.read(EAN13);
    expect(await screen.findByText(en.scan.lookupFailed)).toBeVisible();
    expect(screen.queryByRole('dialog', { name: en.product.title })).toBeNull();
  });

  it('#65-4: if someone adds the same barcode first, the form says so instead of asking for other values', async () => {
    const api = fakeApi({
      catalog: () => Promise.resolve(catalog),
      createProduct: () => Promise.reject(new ApiError(409, 'barcode_taken')),
    });
    const scanner = fakeScanner();
    await atFirstStep(api, scanner);
    click(en.step.scan);
    await cameraOn(scanner);
    scanner.read(EAN13);
    await screen.findByRole('dialog', { name: en.product.title });
    type(en.product.name, 'Scanned curd');
    click(en.product.save);
    expect(await screen.findByText(en.product.barcodeTaken)).toBeVisible();
    expect(screen.queryByText(en.product.refused)).toBeNull();
  });

  it('#65-6: with the camera denied, the digits can still be typed', async () => {
    await atFirstStep(base(), fakeScanner({ problem: 'denied' }));
    click(en.step.scan);
    expect(await screen.findByText(en.scan.denied)).toBeVisible();
    expect(screen.getByLabelText(en.scan.digits)).toBeEnabled();
  });

  it('#65-7: the scan view does not move the step on, and Cancel changes nothing', async () => {
    const scanner = fakeScanner();
    const api = await atFirstStep(base(), scanner);
    type(en.step.grams, '200');
    click(en.step.scan);
    await cameraOn(scanner);
    click(en.scan.cancel);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(scanner.open).toBe(false);
    expect(screen.getByText('Step 1 of 2')).toBeVisible();
    expect(screen.getByLabelText(en.step.grams)).toHaveValue('200');
    expect(api.productByBarcode).not.toHaveBeenCalled();
  });
});
