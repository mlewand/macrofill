import type { SaveMealRequest, TodayEntry } from '@macrofill/domain';
import type { OutboxItem } from '../../src/outbox/store';

const recipeId = '9a13c2a4-8d6e-401e-aeb3-deb367561938';

/** A saved meal waiting in the outbox; `n` (0–9) makes its ids. */
export function outboxItem(n: number, queuedAt = `2026-01-15T07:0${n}:00.000Z`): OutboxItem {
  const request: SaveMealRequest = {
    meal: {
      id: `b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2${n}`,
      recipeId,
      inputMethod: 'direct',
      startedAt: '2026-01-15T07:00:00.000Z',
      finishedAt: queuedAt,
      items: [{ skipped: true }],
    },
    consumptionEntry: {
      id: `c8f4d2b3-5e6a-4f7b-8c9d-8e7f6a5b4c3${n}`,
      eatenAt: queuedAt,
      portion: { type: 'whole' },
    },
  };
  const entry: TodayEntry = {
    id: request.consumptionEntry.id,
    preparedMealId: request.meal.id,
    eatenAt: queuedAt,
    recipeName: { en: 'Curd' },
    nutrition: {
      kcal: 100,
      fat: 1,
      saturates: 0,
      carbs: 1,
      sugars: 0,
      protein: 10,
      salt: 0,
      fibre: null,
    },
  };
  return { request, entry, queuedAt };
}
