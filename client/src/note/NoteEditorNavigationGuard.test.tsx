import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteEditorNavigationGuard } from './NoteEditorNavigationGuard';

const blockerState = vi.hoisted(() => ({
  status: 'idle' as 'idle' | 'blocked',
  nextPathname: '/notes',
  proceed: vi.fn(),
  reset: vi.fn(),
  options: null as null | {
    shouldBlockFn: (args: { current: { pathname: string }; next: { pathname: string } }) => boolean;
    enableBeforeUnload: () => boolean;
  },
}));

vi.mock('@tanstack/react-router', () => ({
  useBlocker: (options: typeof blockerState.options) => {
    blockerState.options = options;
    return {
      status: blockerState.status,
      next: blockerState.status === 'blocked' ? { pathname: blockerState.nextPathname } : undefined,
      proceed: blockerState.status === 'blocked' ? blockerState.proceed : undefined,
      reset: blockerState.status === 'blocked' ? blockerState.reset : undefined,
    };
  },
}));

describe('NoteEditorNavigationGuard', () => {
  afterEach(() => {
    blockerState.status = 'idle';
    blockerState.nextPathname = '/notes';
    blockerState.proceed.mockReset();
    blockerState.reset.mockReset();
    vi.clearAllMocks();
  });

  it('blocks dirty navigation and native unload, while allowing clean and create-to-ID replacement', () => {
    render(
      <NoteEditorNavigationGuard
        canLeave={false}
        phase="dirty"
        flush={vi.fn()}
        retry={vi.fn()}
        discardDraft={vi.fn()}
      >
        <p>Editor</p>
      </NoteEditorNavigationGuard>
    );
    expect(blockerState.options?.enableBeforeUnload()).toBe(true);
    expect(
      blockerState.options?.shouldBlockFn({
        current: { pathname: '/notes/1' },
        next: { pathname: '/notes' },
      })
    ).toBe(true);
    expect(
      blockerState.options?.shouldBlockFn({
        current: { pathname: '/notes/new' },
        next: { pathname: '/notes/14' },
      })
    ).toBe(false);
  });

  it('offers Stay or Retry and leave when a save failed', async () => {
    blockerState.status = 'blocked';
    const retry = vi.fn().mockResolvedValue(undefined);
    render(
      <NoteEditorNavigationGuard
        canLeave={false}
        phase="failed"
        flush={vi.fn()}
        retry={retry}
        discardDraft={vi.fn()}
      >
        <p>Editor</p>
      </NoteEditorNavigationGuard>
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('unsaved changes');
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(blockerState.reset).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Retry and leave' }));
    await waitFor(() => expect(retry).toHaveBeenCalledOnce());
  });

  it('requires explicit discard confirmation before a logout navigation proceeds', () => {
    blockerState.status = 'blocked';
    blockerState.nextPathname = '/login';
    const discardDraft = vi.fn();
    render(
      <NoteEditorNavigationGuard
        canLeave={false}
        phase="dirty"
        flush={vi.fn()}
        retry={vi.fn()}
        discardDraft={discardDraft}
      >
        <p>Editor</p>
      </NoteEditorNavigationGuard>
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('Sign out with an unsaved note');
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft and sign out' }));
    expect(discardDraft).toHaveBeenCalledOnce();
    expect(blockerState.proceed).toHaveBeenCalledOnce();
  });
});
