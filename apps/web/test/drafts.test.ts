import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { startDirectEntry } from '../src/directEntry/state';
import { indexedDbDraftStore, parseDraft } from '../src/storage/drafts';

const recipe = {
  id: '9a13c2a4-8d6e-401e-aeb3-deb367561938',
  name: { en: 'Curd' },
  steps: [
    { id: 'a6b75d73-d68a-4eec-8219-5a16aeb9917e', ingredientClassId: 'curd' },
    { id: 'b48924bb-4fa3-4843-b727-6928f03636d0', ingredientClassId: 'milk' },
  ],
};
const draft = {
  ...startDirectEntry({
    recipe,
    preselected: ['033ee3fe-72a7-409c-8dc3-76626baa14db', undefined],
    mealId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
    entryId: 'c8f4d2b3-5e6a-4f7b-8c9d-8e7f6a5b4c3d',
    startedAt: '2026-01-15T07:00:00.000Z',
  }),
  current: 1,
};
draft.steps[0]!.grams = '200';

describe('Direct Entry drafts in IndexedDB (M5-8)', () => {
  it('M5-8: keeps a draft until it is cleared', async () => {
    const store = indexedDbDraftStore(new IDBFactory());
    expect(await store.load()).toBeUndefined();
    await store.save(draft);
    expect(await store.load()).toEqual(draft);
    await store.clear();
    expect(await store.load()).toBeUndefined();
  });

  it('M5-8: the draft survives a new connection, as after a page reload', async () => {
    const factory = new IDBFactory();
    await indexedDbDraftStore(factory).save(draft);
    expect(await indexedDbDraftStore(factory).load()).toEqual(draft);
  });

  it('M5-8: a newer save replaces the draft', async () => {
    const store = indexedDbDraftStore(new IDBFactory());
    await store.save(draft);
    await store.save({ ...draft, current: 2 });
    expect(await store.load()).toMatchObject({ current: 2 });
  });

  it('M5-8: a stored value that is not a valid draft loads as none', () => {
    expect(parseDraft(draft)).toEqual(draft);
    expect(parseDraft(undefined)).toBeUndefined();
    expect(parseDraft({ ...draft, current: -1 })).toBeUndefined();
    expect(parseDraft({ ...draft, current: 3 })).toBeUndefined();
    expect(parseDraft({ ...draft, steps: draft.steps.slice(1) })).toBeUndefined();
    expect(parseDraft({ ...draft, inputMethod: 'scale' })).toBeUndefined();
    expect(parseDraft({ ...draft, mealId: 'x' })).toBeUndefined();
  });

  it('M5-8: without IndexedDB (e.g. blocked), nothing is kept and nothing breaks', async () => {
    const broken = {
      open: () => {
        throw new Error('blocked');
      },
    } as unknown as IDBFactory;
    const store = indexedDbDraftStore(broken);
    await expect(store.save(draft)).resolves.toBeUndefined();
    await expect(store.load()).resolves.toBeUndefined();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
