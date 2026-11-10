import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteEditorPage } from './NoteEditorPage';
import type { NoteDraft } from './noteDraft';
import type { NoteDetail } from './types';

const state = vi.hoisted(() => ({
  session: {
    phase: 'verified',
    verifiedUserId: 12 as number | null,
    ownerRevision: 0,
    verifySession: vi.fn(),
  },
  note: null as NoteDetail | null,
  snapshot: {
    draft: { title: '', content: null as NoteDraft['content'] },
    phase: 'clean',
    replacementRevision: 0,
    hasUnsavedChanges: false,
    persisted: null as { id: number; version: number } | null,
    writeInFlight: false,
    outcomeUncertain: false,
  },
  edit: vi.fn(),
  retry: vi.fn(),
  resolveConflict: vi.fn(),
  flush: vi.fn(),
  discardDraft: vi.fn(),
  canLeaveNow: vi.fn(() => true),
}));

vi.mock('@/user/session/AuthSessionProvider', () => ({
  useAuthSession: () => state.session,
}));
vi.mock('./queries', () => ({
  useNoteDetail: () => ({
    isPending: false,
    isError: false,
    data: state.note ? { data: state.note } : undefined,
    refetch: vi.fn(),
  }),
}));
vi.mock('./useNoteAutosave', () => ({
  useNoteAutosave: () => ({
    snapshot: state.snapshot,
    edit: state.edit,
    retry: state.retry,
    resolveConflict: state.resolveConflict,
    flush: state.flush,
    discardDraft: state.discardDraft,
    canLeave: true,
    canLeaveNow: state.canLeaveNow,
  }),
}));
vi.mock('./NoteDraftRecoveryProvider', () => ({
  useNoteDraftRecovery: () => ({ peekForVerifiedOwner: () => null }),
}));
vi.mock('@tanstack/react-router', () => ({
  useBlocker: () => ({ status: 'idle', proceed: undefined, reset: undefined }),
}));
vi.mock('@/components/rich-text/RichTextEditor', () => ({
  RichTextEditor: ({ ariaLabel }: { ariaLabel: string }) => <div aria-label={ariaLabel} />,
}));

const content = { type: 'doc' as const, content: [{ type: 'paragraph' as const }] };
const archivedNote: NoteDetail = {
  id: 6,
  title: null,
  content,
  version: 2,
  inbox: false,
  archivedAt: '2026-11-08T10:00:00Z',
  createdAt: '2026-11-07T10:00:00Z',
  updatedAt: '2026-11-09T10:00:00Z',
};

function renderEditor(routeNoteId: string | null = null) {
  return render(<NoteEditorPage routeNoteId={routeNoteId} ownerId={12} onBack={vi.fn()} onCreated={vi.fn()} />);
}

describe('NoteEditorPage', () => {
  afterEach(() => {
    state.session = { phase: 'verified', verifiedUserId: 12, ownerRevision: 0, verifySession: vi.fn() };
    state.note = null;
    state.snapshot = {
      draft: { title: '', content: null as NoteDraft['content'] },
      phase: 'clean',
      replacementRevision: 0,
      hasUnsavedChanges: false,
      persisted: null,
      writeInFlight: false,
      outcomeUncertain: false,
    };
    vi.clearAllMocks();
  });

  it('starts with an empty accessible title and rich text editor without adding a fallback title', () => {
    renderEditor();
    const title = screen.getByRole('textbox', { name: 'Note title' });
    expect(title).toHaveValue('');
    expect(title).toHaveAttribute('placeholder', 'Untitled note');
    expect(screen.getByLabelText('Note content')).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('passes the user-entered title as a draft without inserting a display fallback', () => {
    renderEditor();
    fireEvent.change(screen.getByRole('textbox', { name: 'Note title' }), {
      target: { value: 'A real title' },
    });
    expect(state.edit).toHaveBeenCalledWith({ title: 'A real title', content: null });
  });

  it('allows archived notes to be edited and keeps retry visible after a save failure', () => {
    state.note = archivedNote;
    state.snapshot = {
      draft: { title: '', content },
      phase: 'failed',
      replacementRevision: 0,
      hasUnsavedChanges: true,
      persisted: { id: 6, version: 2 },
      writeInFlight: false,
      outcomeUncertain: false,
    };
    renderEditor('6');

    expect(screen.getByRole('textbox', { name: 'Note title' })).toBeInTheDocument();
    expect(screen.getByText(/Archived/)).toBeInTheDocument();
    expect(screen.getByText('Save failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.retry).toHaveBeenCalledOnce();
  });

  it('requires confirmation before either conflict choice is applied', () => {
    state.note = archivedNote;
    state.snapshot = {
      draft: { title: 'Local', content },
      phase: 'conflict',
      replacementRevision: 0,
      hasUnsavedChanges: true,
      persisted: { id: 6, version: 2 },
      writeInFlight: false,
      outcomeUncertain: false,
    };
    renderEditor('6');

    fireEvent.click(screen.getByRole('button', { name: 'Load latest version' }));
    expect(state.resolveConflict).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('replaces your current draft');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(state.resolveConflict).toHaveBeenCalledWith('load-server');
  });

  it('keeps the same editor mounted during same-owner session verification', () => {
    state.note = archivedNote;
    const rendered = renderEditor('6');
    const editor = screen.getByLabelText('Note content');
    state.session = {
      phase: 'verifying',
      verifiedUserId: null,
      ownerRevision: 0,
      verifySession: vi.fn(),
    };
    rendered.rerender(
      <NoteEditorPage
        routeNoteId="6"
        ownerId={12}
        onBack={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Note content')).toBe(editor);
  });
});
