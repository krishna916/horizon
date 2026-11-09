import { describe, expect, it } from 'vitest';
import { parseNoteId } from './noteNavigation';

describe('parseNoteId', () => {
  it.each([
    ['7', 7],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
  ])('accepts positive safe decimal IDs (%s)', (raw, expected) => {
    expect(parseNoteId(raw)).toBe(expected);
  });

  it.each(['0', '-1', '1.5', 'abc', '9007199254740992', '', ' 7'])(
    'rejects invalid IDs (%s)',
    (raw) => {
      expect(parseNoteId(raw)).toBeNull();
    }
  );
});
