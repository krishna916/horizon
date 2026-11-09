export interface HorizonNoteNavigationState {
  kind: 'from-workspace';
  noteId?: number;
}

declare module '@tanstack/react-router' {
  interface HistoryState {
    horizonNoteNavigation?: HorizonNoteNavigationState;
  }
}

export function parseNoteId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function isTrustedNoteOrigin(
  state: HorizonNoteNavigationState | undefined,
  noteId?: number
): boolean {
  return state?.kind === 'from-workspace' && (noteId === undefined || state.noteId === noteId);
}
