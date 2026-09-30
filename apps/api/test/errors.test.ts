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

  it("spells out an AggregateError, whose message is empty (Node's connect to every address of a host)", () => {
    const refused = (address: string) =>
      Object.assign(new Error(`connect ECONNREFUSED ${address}:5432`), { code: 'ECONNREFUSED' });
    const aggregate = Object.assign(
      new AggregateError([refused('::1'), refused('127.0.0.1')], ''),
      {
        code: 'ECONNREFUSED',
      },
    );
    const wrapped = new Error('Failed query: select 1', { cause: aggregate });
    expect(describeError(wrapped)).toBe(
      'Failed query: select 1\n  caused by: ECONNREFUSED: connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432',
    );
  });

  it('stops on a cause cycle', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(describeError(a)).toBe('a\n  caused by: b');
  });
});
