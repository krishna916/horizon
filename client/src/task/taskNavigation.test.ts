import { describe, expect, it } from 'vitest';
import { parseTaskSelection } from './taskNavigation';

describe('parseTaskSelection', () => {
  it('recognizes a missing selection', () => {
    expect(parseTaskSelection(undefined)).toEqual({ kind: 'none' });
    expect(parseTaskSelection(null)).toEqual({ kind: 'none' });
  });

  it('accepts positive safe integer IDs from numbers and digit strings', () => {
    expect(parseTaskSelection(123)).toEqual({ kind: 'valid', id: 123 });
    expect(parseTaskSelection('123')).toEqual({ kind: 'valid', id: 123 });
    expect(parseTaskSelection('1')).toEqual({ kind: 'valid', id: 1 });
  });

  it.each([
    '0',
    '-1',
    '1.5',
    '1e3',
    '9007199254740993',
    'abc',
    '',
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    {},
  ])('rejects an invalid task ID (%o)', (raw) => {
    expect(parseTaskSelection(raw)).toEqual({ kind: 'invalid' });
  });
});
