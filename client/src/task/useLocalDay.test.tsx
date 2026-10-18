import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLocalDay } from './useLocalDay';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useLocalDay', () => {
  it('updates at local midnight and schedules the following day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 18, 23, 59, 50));

    const { result } = renderHook(() => useLocalDay());

    expect(result.current.getDate()).toBe(18);
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.getDate()).toBe(19);
    act(() => vi.advanceTimersByTime(24 * 60 * 60 * 1000));
    expect(result.current.getDate()).toBe(20);
  });

  it('refreshes after focus or visibility resumes a sleeping tab', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 18, 12));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });

    const { result } = renderHook(() => useLocalDay());
    vi.setSystemTime(new Date(2026, 9, 20, 9));

    act(() => window.dispatchEvent(new Event('focus')));
    expect(result.current.getDate()).toBe(20);

    vi.setSystemTime(new Date(2026, 9, 21, 9));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current.getDate()).toBe(21);
  });

  it('clears its timer and removes resume listeners on unmount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 18, 12));
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderHook(() => useLocalDay());
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(removeWindowListener).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('schedules the next calendar midnight across the US fall DST boundary', () => {
    vi.useFakeTimers();
    const start = new Date(2026, 10, 1, 0, 0, 0);
    vi.setSystemTime(start);
    const { result } = renderHook(() => useLocalDay());
    const nextMidnight = new Date(2026, 10, 2, 0, 0, 0);
    const untilMidnight = nextMidnight.getTime() - start.getTime();

    if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/New_York') {
      expect(untilMidnight).toBe(25 * 60 * 60 * 1000);
    }

    act(() => vi.advanceTimersByTime(untilMidnight));

    expect(result.current.getDate()).toBe(2);
    expect(result.current.getMonth()).toBe(10);
  });
});
