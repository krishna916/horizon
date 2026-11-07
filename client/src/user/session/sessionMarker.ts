export const SESSION_MARKER_KEY = 'horizon:auth-session-change:v1';

let fallbackSequence = 0;

function createOpaqueMarker(): string {
  let cryptoApi: Crypto | undefined;
  try {
    cryptoApi = globalThis.crypto;
    const marker = cryptoApi?.randomUUID?.();
    if (marker) return marker;
  } catch {
    // Some browsers expose crypto but deny access to randomUUID.
  }

  try {
    if (cryptoApi?.getRandomValues) {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // Fall back to a non-sensitive change marker if Web Crypto is unavailable.
  }

  fallbackSequence += 1;
  return `${Date.now().toString(36)}-${fallbackSequence.toString(36)}`;
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
