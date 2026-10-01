import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { saveRequest, startDirectEntry } from '../src/directEntry/state';
import { indexedDbDraftStore, parseDraft } from '../src/storage/drafts';

const recipe = {
  id: '9a13c2a4-8d6e-401e-aeb3-deb367561938',
  name: { en: 'Curd' },
  steps: [
    { id: 'a6b75d73-d68a-4eec-8219-5a16aeb9917e', ingredientClassId: 'curd' },
    { id: 'b48924bb-4fa3-4843-b727-6928f03636d0', ingredientClassId: 'milk' },
  ],
};
const state = {
  ...startDirectEntry({
    recipe,
    preselected: ['033ee3fe-72a7-409c-8dc3-76626baa14db', undefined],
    mealId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
    entryId: 'c8f4d2b3-5e6a-4f7b-8c9d-8e7f6a5b4c3d',
    startedAt: '2026-01-15T07:00:00.000Z',
  }),
  current: 1,
};
state.steps[0]!.grams = '200';
const draft = { state, username: 'mlewand' };

describe('Direct Entry drafts in IndexedDB (M5-8)', () => {
  it('M5-8: keeps a draft until it is cleared', async () => {
    const store = indexedDbDraftStore(new IDBFactory());
    expect(await store.load()).toBeUndefined();
    expect(await store.save(draft)).toBe(true);
    expect(await store.load()).toEqual(draft);
    expect(await store.clear()).toBe(true);
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
    await store.save({ state: { ...state, current: 2 }, username: 'mlewand' });
    expect(await store.load()).toMatchObject({ state: { current: 2 } });
  });

  it('M5-8: a stored value that is not a valid draft loads as none', () => {
    expect(parseDraft(draft)).toEqual(draft);
    expect(parseDraft(undefined)).toBeUndefined();
    expect(parseDraft(state)).toBeUndefined();
    const bad = (change: object) =>
      parseDraft({ state: { ...state, ...change }, username: 'mlewand' });
    expect(bad({ current: -1 })).toBeUndefined();
    expect(bad({ current: 3 })).toBeUndefined();
    expect(bad({ steps: state.steps.slice(1) })).toBeUndefined();
    expect(bad({ inputMethod: 'scale' })).toBeUndefined();
    expect(bad({ mealId: 'x' })).toBeUndefined();
  });

  it('M5-8: a kept session without its owner loads as none, so nobody else takes it on (regression: #37)', () => {
    expect(parseDraft({ state })).toBeUndefined();
    expect(parseDraft({ state, username: '' })).toBeUndefined();
    expect(parseDraft({ state, username: 'mlewand' })).toEqual({ state, username: 'mlewand' });
  });

  it('M5-8: keeps the first save request sent, which must be for this meal', () => {
    const complete = {
      ...state,
      current: 2,
      steps: state.steps.map((s) => ({
        ...s,
        productId: '033ee3fe-72a7-409c-8dc3-76626baa14db',
        grams: '1',
      })),
    };
    const request = saveRequest(complete, '2026-01-15T07:05:00.000Z')!;
    expect(parseDraft({ state, sent: request, username: 'mlewand' })).toEqual({
      state,
      sent: request,
      username: 'mlewand',
    });
    const other = {
      ...request,
      meal: { ...request.meal, id: 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b' },
    };
    expect(parseDraft({ state, sent: other, username: 'mlewand' })).toBeUndefined();
  });

  it('M5-8: without IndexedDB (e.g. blocked), nothing is kept and nothing breaks', async () => {
    const broken = {
      open: () => {
        throw new Error('blocked');
      },
    } as unknown as IDBFactory;
    const store = indexedDbDraftStore(broken);
    // It says so, for a caller that must know (a request about to be sent).
    await expect(store.save(draft)).resolves.toBe(false);
    await expect(store.load()).resolves.toBeUndefined();
    await expect(store.clear()).resolves.toBe(false);
  });
});
