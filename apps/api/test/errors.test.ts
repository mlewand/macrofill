import { describe, expect, it } from 'vitest';
import { describeError } from '../src/errors';

describe('describeError', () => {
  it('includes the whole cause chain, so a wrapped database error shows its real reason', () => {
    const cause = new Error('password authentication failed for user "macrofill"');
    const wrapped = new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"', { cause });
    expect(describeError(wrapped)).toBe(
      'Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"\n  caused by: password authentication failed for user "macrofill"',
    );
  });

  it('handles plain values and errors without a cause', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('text')).toBe('text');
    expect(describeError({ code: 'ECONNREFUSED' })).toBe('{"code":"ECONNREFUSED"}');
  });

  it('stops on a cause cycle', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(describeError(a)).toBe('a\n  caused by: b');
  });
});
