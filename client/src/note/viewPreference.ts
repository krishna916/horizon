import type { NoteViewMode } from './types';

function storageKey(userId: number): string {
  return `horizon:notes:view:${userId}`;
}

function isValidUserId(userId: number): boolean {
  return Number.isSafeInteger(userId) && userId > 0;
}

export function readNoteViewPreference(userId: number): NoteViewMode {
  if (!isValidUserId(userId)) return 'cards';
  try {
    const preference = window.localStorage.getItem(storageKey(userId));
    return preference === 'list' || preference === 'cards' ? preference : 'cards';
  } catch {
    return 'cards';
  }
}

export function writeNoteViewPreference(userId: number, view: NoteViewMode): void {
  if (!isValidUserId(userId) || (view !== 'cards' && view !== 'list')) return;
  try {
    window.localStorage.setItem(storageKey(userId), view);
  } catch {
    // The selected mode remains available in memory when browser storage is blocked.
  }
}
