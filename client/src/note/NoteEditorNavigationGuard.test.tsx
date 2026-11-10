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
        canLeaveNow={() => true}
        persistedNoteIdNow={() => 14}
        phase="dirty"
        writeInFlight={false}
        outcomeUncertain={false}
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
    expect(
      blockerState.options?.shouldBlockFn({
        current: { pathname: '/notes/new' },
        next: { pathname: '/notes/99' },
      })
    ).toBe(true);
  });

  it('offers Stay or Retry and leave when a save failed', async () => {
    blockerState.status = 'blocked';
    const retry = vi.fn().mockResolvedValue(undefined);
    render(
      <NoteEditorNavigationGuard
        canLeave={false}
        canLeaveNow={() => true}
        persistedNoteIdNow={() => null}
        phase="failed"
        writeInFlight={false}
        outcomeUncertain={true}
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
    expect(blockerState.proceed).toHaveBeenCalledOnce();
  });

  it('requires explicit discard confirmation before a logout navigation proceeds', () => {
    blockerState.status = 'blocked';
    blockerState.nextPathname = '/login';
    const discardDraft = vi.fn();
    render(
      <NoteEditorNavigationGuard
        canLeave={false}
        canLeaveNow={() => true}
        persistedNoteIdNow={() => null}
        phase="dirty"
        writeInFlight={false}
        outcomeUncertain={false}
        flush={vi.fn()}
        retry={vi.fn()}
        discardDraft={discardDraft}
      >
        <p>Editor</p>
      </NoteEditorNavigationGuard>
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('Sign out with an unsaved note');
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsent changes and sign out' }));
    expect(discardDraft).toHaveBeenCalledOnce();
    expect(blockerState.proceed).toHaveBeenCalledOnce();
  });

  it('checks synchronous coordinator state after Wait resolves before React rerenders', async () => {
    blockerState.status = 'blocked';
    const flush = vi.fn().mockResolvedValue(undefined);
    render(
      <NoteEditorNavigationGuard
        canLeave={false}
        canLeaveNow={() => true}
        persistedNoteIdNow={() => null}
        phase="saving"
        writeInFlight={true}
        outcomeUncertain={false}
        flush={flush}
        retry={vi.fn()}
        discardDraft={vi.fn()}
      >
        <p>Editor</p>
      </NoteEditorNavigationGuard>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Wait for save' }));
    await waitFor(() => expect(flush).toHaveBeenCalledOnce());
    expect(blockerState.proceed).toHaveBeenCalledOnce();
  });

  it('does not describe an issued write as discardable and requires acknowledgement to leave', () => {
    blockerState.status = 'blocked';
    blockerState.nextPathname = '/login';
    render(
      <NoteEditorNavigationGuard
        canLeave={false}
        canLeaveNow={() => false}
        persistedNoteIdNow={() => null}
        phase="saving"
        writeInFlight
        outcomeUncertain={false}
        flush={vi.fn()}
        retry={vi.fn()}
        discardDraft={vi.fn()}
      >
        <p>Editor</p>
      </NoteEditorNavigationGuard>
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('It may still be applied');
    expect(screen.getByRole('button', { name: 'Wait for save and sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Discard/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out without waiting' }));
    expect(blockerState.proceed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /changes may already have saved/ }));
    expect(blockerState.proceed).toHaveBeenCalledOnce();
  });

  it('stays blocked if flush resolves while the coordinator still has unsaved work', async () => {
    blockerState.status = 'blocked';
    const flush = vi.fn().mockResolvedValue(undefined);
    render(
      <NoteEditorNavigationGuard
        canLeave={false}
        canLeaveNow={() => false}
        persistedNoteIdNow={() => null}
        phase="saving"
        writeInFlight={true}
        outcomeUncertain={false}
        flush={flush}
        retry={vi.fn()}
        discardDraft={vi.fn()}
      >
        <p>Editor</p>
      </NoteEditorNavigationGuard>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Wait for save' }));
    await waitFor(() => expect(flush).toHaveBeenCalledOnce());
    expect(blockerState.proceed).not.toHaveBeenCalled();
  });

  it('moves focus into the leave modal, traps Tab, and lets Escape stay', () => {
    blockerState.status = 'blocked';
    blockerState.nextPathname = '/login';
    render(
      <NoteEditorNavigationGuard
        canLeave={false}
        canLeaveNow={() => false}
        persistedNoteIdNow={() => null}
        phase="dirty"
        writeInFlight={false}
        outcomeUncertain={false}
        flush={vi.fn()}
        retry={vi.fn()}
        discardDraft={vi.fn()}
      >
        <p>Editor</p>
      </NoteEditorNavigationGuard>
    );

    const dialog = screen.getByRole('dialog');
    const stay = screen.getByRole('button', { name: 'Stay' });
    const discard = screen.getByRole('button', { name: 'Discard unsent changes and sign out' });
    expect(document.activeElement).toBe(stay);
    fireEvent.keyDown(stay, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(discard);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(blockerState.reset).toHaveBeenCalledOnce();
  });
});
