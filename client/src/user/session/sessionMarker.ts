export const SESSION_MARKER_KEY = 'horizon:auth-session-change:v1';

let fallbackSequence = 0;

function createOpaqueMarker(): string {
  try {
    const marker = globalThis.crypto?.randomUUID?.();
    if (marker) return marker;
  } catch {
    // Some browsers expose crypto but deny access to randomUUID.
  }

  fallbackSequence += 1;
  return [
    Date.now().toString(36),
    fallbackSequence.toString(36),
    Math.random().toString(36).slice(2),
  ].join('-');
}

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readSessionMarker(): string | null {
  try {
    return getStorage()?.getItem(SESSION_MARKER_KEY) ?? null;
  } catch {
    return null;
  }
}

export function publishSessionMarker(): string | null {
  const marker = createOpaqueMarker();
  try {
    const storage = getStorage();
    if (!storage) return null;
    storage.setItem(SESSION_MARKER_KEY, marker);
    return marker;
  } catch {
    return null;
  }
}
