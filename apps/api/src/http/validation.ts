import type { Context } from 'hono';
import { validator } from 'hono/validator';
import type { z } from 'zod';

export interface Issue {
  /** Dotted path into the body, e.g. `meal.items.0.grams`. */
  path: string;
  message: string;
}

export function invalidRequest(c: Context, issues: Issue[]) {
  return c.json({ error: 'invalid_request' as const, issues }, 400);
}

/**
 * M4-4: validates the JSON body with a shared domain schema. Invalid input gets 400 with
 * field-level errors; malformed JSON gets 400 `invalid_json` (see `app.onError`).
 */
export function jsonBody<T extends z.ZodType>(schema: T) {
  return validator('json', (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      return invalidRequest(
        c,
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return result.data;
  });
}

/** Validates path parameters with a domain schema; invalid ones get 400 with field-level errors. */
export function params<T extends z.ZodType>(schema: T) {
  return validator('param', (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      return invalidRequest(
        c,
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return result.data;
  });
}
