import { afterEach, describe, expect, it, vi } from 'vitest';
import { readNoteViewPreference, writeNoteViewPreference } from './viewPreference';

describe('Notes view preference', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('defaults each owner to Cards and restores only that owner’s saved view', () => {
    expect(readNoteViewPreference(1)).toBe('cards');
    writeNoteViewPreference(1, 'list');

    expect(readNoteViewPreference(1)).toBe('list');
    expect(readNoteViewPreference(2)).toBe('cards');
    expect(localStorage.getItem('horizon:notes:view:1')).toBe('list');
    expect(localStorage.getItem('horizon:notes:view:2')).toBeNull();
  });

  it('ignores invalid values and storage errors without storing Note data', () => {
    localStorage.setItem('horizon:notes:view:1', '{"title":"private note"}');
    expect(readNoteViewPreference(1)).toBe('cards');

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(readNoteViewPreference(2)).toBe('cards');

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(() => writeNoteViewPreference(2, 'list')).not.toThrow();
  });
});
