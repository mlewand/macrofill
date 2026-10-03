import type { CatalogProduct } from '@macrofill/domain';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiContext, ApiError, type Api } from '../src/api/api';
import en from '../src/i18n/en.json';
import { ProductDialog, ProductForm } from '../src/products/ProductForm';
import { fakeApi } from './support/api';

const classes = [
  { id: 'curd', name: { en: 'Curd' } },
  { id: 'milk', name: { en: 'Milk' } },
];

const field = (name: string) => screen.getByLabelText(name);
const type = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: en.product.save }));
const f = en.product.field;

function setup(api: Api = fakeApi(), props: Partial<Parameters<typeof ProductForm>[0]> = {}) {
  const onSaved = vi.fn<(product: CatalogProduct) => void>();
  const onCancel = vi.fn();
  render(
    <ApiContext value={api}>
      <ProductForm
        ingredientClasses={classes}
        ingredientClassId="curd"
        onSaved={onSaved}
        onCancel={onCancel}
        {...props}
      />
    </ApiContext>,
  );
  return { api, onSaved, onCancel };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the product form', () => {
  it('#64-1: has name, brand, the ingredient class preselected, and the eight per-100 g values, all empty', () => {
    setup();
    expect(field(en.product.name)).toHaveValue('');
    expect(field(en.product.brand)).toHaveValue('');
    expect(field(en.product.ingredientClass)).toHaveValue('curd');
    for (const label of Object.values(f)) expect(field(label)).toHaveValue('');
  });

  it('#64-1: the name is required; nothing is sent without it', () => {
    const { api } = setup();
    save();
    expect(screen.getByText(en.product.problem.name)).toBeVisible();
    expect(field(en.product.name)).toBeInvalid();
    expect(api.createProduct).not.toHaveBeenCalled();
  });

  it('#64-1, #64-2: sends 3,2 and 3.2 as 3.2, an empty value as unknown, and a generated id', async () => {
    const { api, onSaved } = setup();
    type(en.product.name, 'Homemade curd');
    type(en.product.brand, 'Home');
    type(f.protein, '17');
    type(f.fat, '4,2');
    type(f.carbs, '3.4');
    type(f.kcal, '119');
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const { id, ...sent } = vi.mocked(api.createProduct).mock.calls[0]![0];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent).toEqual({
      ingredientClassId: 'curd',
      name: 'Homemade curd',
      brand: 'Home',
      nutrition: {
        kcal: 119,
        fat: 4.2,
        saturates: null,
        carbs: 3.4,
        sugars: null,
        protein: 17,
        salt: null,
        fibre: null,
      },
    });
    expect(onSaved.mock.calls[0]![0]).toMatchObject({ name: 'Homemade curd', source: 'manual' });
  });

  it('#64-2: a negative, malformed or too large value is named on its field and nothing is sent', () => {
    const { api } = setup();
    type(en.product.name, 'x');
    type(f.fat, '-1');
    type(f.sugars, 'abc');
    type(f.salt, '101');
    save();
    expect(field(f.fat)).toBeInvalid();
    expect(screen.getByText(en.product.problem.negative)).toBeVisible();
    expect(screen.getByText(en.product.problem.invalid)).toBeVisible();
    expect(screen.getByText(en.product.problem.tooLarge)).toBeVisible();
    expect(api.createProduct).not.toHaveBeenCalled();
  });

  it('#64-2: values that add up to more than 100 g are refused with one message', () => {
    const { api } = setup();
    type(en.product.name, 'x');
    type(f.carbs, '50');
    type(f.protein, '40');
    type(f.fat, '20');
    save();
    expect(screen.getByRole('alert')).toHaveTextContent(en.product.problem.total);
    expect(api.createProduct).not.toHaveBeenCalled();
  });

  it('#64-1: another ingredient class can be chosen', async () => {
    const { api } = setup();
    type(en.product.name, 'Oat milk');
    fireEvent.change(field(en.product.ingredientClass), { target: { value: 'milk' } });
    save();
    await waitFor(() => expect(api.createProduct).toHaveBeenCalled());
    expect(vi.mocked(api.createProduct).mock.calls[0]![0].ingredientClassId).toBe('milk');
  });

  it('opens prefilled, for the barcode and lookup flows to reuse (#65, #66)', () => {
    setup(fakeApi(), {
      initial: { name: 'From a database', nutrition: { fat: '1,5' } },
    });
    expect(field(en.product.name)).toHaveValue('From a database');
  });

  it('Cancel leaves without saving', () => {
    const { api, onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: en.product.cancel }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(api.createProduct).not.toHaveBeenCalled();
  });
});

describe('#64-3: the kcal check', () => {
  const macros = () => {
    type(en.product.name, 'Mystery');
    type(f.protein, '10');
    type(f.carbs, '20');
    type(f.fat, '8,9');
    type(f.fibre, '0');
  };

  it('warns when kcal does not match the macros, and saves only after confirming', async () => {
    const { api, onSaved } = setup();
    macros();
    type(f.kcal, '500');
    save();
    expect(screen.getByRole('alert')).toHaveTextContent('500');
    expect(screen.getByRole('alert')).toHaveTextContent('200');
    expect(api.createProduct).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: en.product.saveAnyway }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(vi.mocked(api.createProduct).mock.calls[0]![0].nutrition.kcal).toBe(500);
  });

  it('Fix the values dismisses the warning, and editing a value asks again', () => {
    const { api } = setup();
    macros();
    type(f.kcal, '500');
    save();
    fireEvent.click(screen.getByRole('button', { name: en.product.fixValues }));
    expect(screen.queryByRole('button', { name: en.product.saveAnyway })).toBeNull();
    type(f.kcal, '510');
    save();
    expect(screen.getByRole('button', { name: en.product.saveAnyway })).toBeVisible();
    // The confirmation covers the values it was given for, not edited ones.
    type(f.kcal, '520');
    expect(screen.queryByRole('button', { name: en.product.saveAnyway })).toBeNull();
    expect(api.createProduct).not.toHaveBeenCalled();
  });

  it('saves a matching product without asking', async () => {
    const { onSaved } = setup();
    macros();
    type(f.kcal, '200');
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it('is skipped when a value it needs is unknown', async () => {
    const { onSaved } = setup();
    macros();
    type(f.fibre, '');
    type(f.kcal, '900');
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });
});

describe('#64-7, #64-8: needs a connection, and a retry is safe', () => {
  const online = (value: boolean) =>
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);

  it('#64-7: offline, the form says so and does not save', () => {
    online(false);
    const { api } = setup();
    type(en.product.name, 'x');
    expect(screen.getByRole('status')).toHaveTextContent(en.product.offline);
    expect(screen.getByRole('button', { name: en.product.save })).toBeDisabled();
    fireEvent.submit(field(en.product.name));
    expect(api.createProduct).not.toHaveBeenCalled();
  });

  it('#64-7: it can save again once the connection is back', () => {
    const spy = online(false);
    setup();
    expect(screen.getByRole('button', { name: en.product.save })).toBeDisabled();
    spy.mockReturnValue(true);
    fireEvent(window, new Event('online'));
    expect(screen.getByRole('button', { name: en.product.save })).toBeEnabled();
    expect(screen.queryByText(en.product.offline)).toBeNull();
  });

  it('#64-7, #64-8: a request that fails without an answer keeps the values and retries with the same id', async () => {
    // Guest Wi-Fi reports "online" and still doesn't answer.
    const createProduct = vi
      .fn<Api['createProduct']>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation((request) =>
        Promise.resolve({ ...request, source: 'manual' as const, lastUsedAt: null }),
      );
    const { onSaved } = setup(fakeApi({ createProduct }));
    type(en.product.name, 'Homemade curd');
    type(f.protein, '17');
    save();
    expect(await screen.findByText(en.product.failed)).toBeVisible();
    expect(field(en.product.name)).toHaveValue('Homemade curd');
    expect(field(f.protein)).toHaveValue('17');
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const [first, second] = createProduct.mock.calls.map(([request]) => request);
    expect(second!.id).toBe(first!.id);
  });

  it('a refusal by the server says so, and is not a connection problem', async () => {
    const createProduct = vi.fn<Api['createProduct']>().mockRejectedValue(new ApiError(400));
    setup(fakeApi({ createProduct }));
    type(en.product.name, 'x');
    save();
    expect(await screen.findByText(en.product.refused)).toBeVisible();
    expect(screen.queryByText(en.product.failed)).toBeNull();
  });

  it('#64-8: Cancel is not available while the product is being saved, so a saved product is never one the user cancelled (regression: #72)', async () => {
    let finish!: (product: CatalogProduct) => void;
    const createProduct = vi.fn<Api['createProduct']>(
      () => new Promise<CatalogProduct>((resolve) => (finish = resolve)),
    );
    const { onSaved, onCancel } = setup(fakeApi({ createProduct }));
    type(en.product.name, 'x');
    save();
    const cancel = screen.getByRole('button', { name: en.product.cancel });
    expect(cancel).toBeDisabled();
    fireEvent.click(cancel);
    expect(onCancel).not.toHaveBeenCalled();
    // The save went through: it is the form's to finish, and Cancel is back if it had failed.
    const request = vi.mocked(createProduct).mock.calls[0]![0];
    await act(async () => {
      finish({ ...request, source: 'manual', lastUsedAt: null });
      await Promise.resolve();
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('#64-8: nothing can be edited while the product is being saved, so what is stored is what the user sees (regression: #72)', async () => {
    let finish!: (product: CatalogProduct) => void;
    const createProduct = vi.fn<Api['createProduct']>(
      () => new Promise<CatalogProduct>((resolve) => (finish = resolve)),
    );
    setup(fakeApi({ createProduct }));
    type(en.product.name, 'x');
    type(f.fat, '5');
    save();
    for (const label of [
      en.product.name,
      en.product.brand,
      en.product.ingredientClass,
      ...Object.values(f),
    ]) {
      expect(field(label), label).toBeDisabled();
    }
    // Back for a retry after a failure, with the values as they were.
    const request = vi.mocked(createProduct).mock.calls[0]![0];
    await act(async () => {
      finish({ ...request, source: 'manual', lastUsedAt: null });
      await Promise.resolve();
    });
  });

  it('#64-8: the fields are editable again after a failed save, with what was typed (regression: #72)', async () => {
    const createProduct = vi.fn<Api['createProduct']>().mockRejectedValue(new TypeError('x'));
    setup(fakeApi({ createProduct }));
    type(en.product.name, 'x');
    type(f.fat, '5');
    save();
    await screen.findByText(en.product.failed);
    expect(field(en.product.name)).toBeEnabled();
    expect(field(f.fat)).toBeEnabled();
    expect(field(f.fat)).toHaveValue('5');
  });

  it('#64-8: Cancel is back after a failed save (regression: #72)', async () => {
    const createProduct = vi.fn<Api['createProduct']>().mockRejectedValue(new TypeError('x'));
    setup(fakeApi({ createProduct }));
    type(en.product.name, 'x');
    save();
    await screen.findByText(en.product.failed);
    expect(screen.getByRole('button', { name: en.product.cancel })).toBeEnabled();
  });

  it('a second tap while saving sends once', () => {
    let finish!: (product: CatalogProduct) => void;
    const createProduct = vi.fn<Api['createProduct']>(
      () => new Promise<CatalogProduct>((resolve) => (finish = resolve)),
    );
    setup(fakeApi({ createProduct }));
    type(en.product.name, 'x');
    save();
    expect(screen.getByRole('button', { name: en.product.saving })).toBeDisabled();
    fireEvent.submit(field(en.product.name));
    expect(createProduct).toHaveBeenCalledOnce();
    finish({
      id: vi.mocked(createProduct).mock.calls[0]![0].id,
      ingredientClassId: 'curd',
      name: 'x',
      nutrition: vi.mocked(createProduct).mock.calls[0]![0].nutrition,
      source: 'manual',
      lastUsedAt: null,
    });
  });
});

describe('inside another form', () => {
  it('#64-6: submitting the dialog never submits the form it was opened from (the step, in Direct Entry)', async () => {
    const outer = vi.fn((event: React.FormEvent) => event.preventDefault());
    const api = fakeApi();
    render(
      <ApiContext value={api}>
        <form onSubmit={outer}>
          <ProductDialog
            ingredientClasses={classes}
            ingredientClassId="curd"
            onSaved={vi.fn()}
            onCancel={vi.fn()}
          />
        </form>
      </ApiContext>,
    );
    type(en.product.name, 'x');
    save();
    await waitFor(() => expect(api.createProduct).toHaveBeenCalled());
    expect(outer).not.toHaveBeenCalled();
  });
});
