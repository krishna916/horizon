import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishSessionMarker, readSessionMarker, SESSION_MARKER_KEY } from './sessionMarker';

describe('session marker', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('publishes distinct opaque markers without identity data', () => {
    const first = publishSessionMarker();
    const second = publishSessionMarker();

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(localStorage.getItem(SESSION_MARKER_KEY)).toBe(second);
    expect(second?.toLowerCase()).not.toMatch(/email|password|token|user/);
    expect(second).not.toContain('one@example.com');
  });

  it('uses Web Crypto when randomUUID is unavailable', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('randomUUID unavailable');
    });
    const getRandomValues = vi
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementation((bytes) => {
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).fill(0xab);
        return bytes;
      });

    const marker = publishSessionMarker();

    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(marker).toBe('ab'.repeat(16));
  });

  it('ignores storage security errors', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });

    expect(publishSessionMarker()).toBeNull();
    expect(readSessionMarker()).toBeNull();
  });

  it('reads the current marker or null', () => {
    expect(readSessionMarker()).toBeNull();
    localStorage.setItem(SESSION_MARKER_KEY, 'opaque-marker');
    expect(readSessionMarker()).toBe('opaque-marker');
  });
});
