export type TaskSelection =
  { kind: 'none' } | { kind: 'create' } | { kind: 'valid'; id: number } | { kind: 'invalid' };

export type HorizonTaskNavigationState =
  | {
      kind: 'panel-from-list' | 'page-from-panel';
      taskId: number;
    }
  | { kind: 'creation-from-list' };

declare module '@tanstack/react-router' {
  interface HistoryState {
    horizonTaskNavigation?: HorizonTaskNavigationState;
  }
}

export function parseTaskSelection(raw: unknown, create?: unknown): TaskSelection {
  if ((raw === undefined || raw === null) && create === true) {
    return { kind: 'create' };
  }
  if (raw === undefined || raw === null) {
    return { kind: 'none' };
  }

  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw > 0 ? { kind: 'valid', id: raw } : { kind: 'invalid' };
  }

  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    return { kind: 'invalid' };
  }

  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? { kind: 'valid', id } : { kind: 'invalid' };
}
