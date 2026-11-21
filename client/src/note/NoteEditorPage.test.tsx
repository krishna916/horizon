import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    draft: { title: '', content: null as NoteDraft['content'] } as NoteDraft,
    phase: 'clean',
    replacementRevision: 0,
    hasUnsavedChanges: false,
    tagValidationError: null as string | null,
    knownTags: [] as Array<{ id: number; name: string }>,
    persisted: null as { id: number; version: number } | null,
    writeInFlight: false,
    outcomeUncertain: false,
    resolvingConflict: false,
    lifecycleBusy: false,
  },
  prepareLifecycleMutation: vi.fn(async () => null as { id: number; version: number } | null),
  completeLifecycleMutation: vi.fn(),
  cancelLifecycleMutation: vi.fn(),
  lifecycleRun: vi.fn(
    async () => null as { kind: 'note'; note: NoteDetail } | { kind: 'deleted' } | null
  ),
  onBack: vi.fn(),
  edit: vi.fn(),
  retry: vi.fn(),
  resolveConflict: vi.fn(),
  flush: vi.fn(),
  discardDraft: vi.fn(),
  canLeaveNow: vi.fn(() => true),
  persistedNoteIdNow: vi.fn(() => null),
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
    persistedNoteIdNow: state.persistedNoteIdNow,
    prepareLifecycleMutation: state.prepareLifecycleMutation,
    completeLifecycleMutation: state.completeLifecycleMutation,
    cancelLifecycleMutation: state.cancelLifecycleMutation,
  }),
}));
vi.mock('./NoteLifecycleProvider', () => ({
  useNoteLifecycle: () => ({
    ownerId: 12,
    run: state.lifecycleRun,
    stateFor: () => ({ pending: false, error: null, retry: vi.fn() }),
  }),
}));
vi.mock('./NoteDraftRecoveryProvider', () => ({
  useNoteDraftRecovery: () => ({ peekForVerifiedOwner: () => null }),
}));
vi.mock('@tanstack/react-router', () => ({
  useBlocker: () => ({ status: 'idle', proceed: undefined, reset: undefined }),
}));
vi.mock('@/components/rich-text/RichTextEditor', () => ({
  RichTextEditor: ({ ariaLabel, disabled }: { ariaLabel: string; disabled?: boolean }) => (
    <div aria-label={ariaLabel} aria-disabled={disabled} />
  ),
}));
vi.mock('@/tag/TagSelector', () => ({
  TagSelector: ({
    value,
    onChange,
    userId,
    knownTags,
    createLabel,
    disabled,
  }: {
    value: Array<{ id: number } | { name: string }>;
    onChange: (value: Array<{ id: number } | { name: string }>) => void;
    userId: number;
    knownTags: Array<{ id: number; name: string }>;
    createLabel: string;
    disabled?: boolean;
  }) => (
    <div aria-label="Note Tags" data-user-id={userId} aria-disabled={disabled}>
      {value.map((tag) =>
        'name' in tag
          ? tag.name
          : (knownTags.find((knownTag) => knownTag.id === tag.id)?.name ?? `Tag ${tag.id}`)
      )}
      <button type="button" onClick={() => onChange([{ name: 'Ideas' }])}>
        {createLabel === 'add' ? 'Add tag' : 'Create tag'}
      </button>
    </div>
  ),
}));

const content = { type: 'doc' as const, content: [{ type: 'paragraph' as const }] };
const archivedNote: NoteDetail = {
  id: 6,
  title: null,
  content,
  tags: [],
  version: 2,
  inbox: false,
  archivedAt: '2026-11-08T10:00:00Z',
  createdAt: '2026-11-07T10:00:00Z',
  updatedAt: '2026-11-09T10:00:00Z',
};

function renderEditor(routeNoteId: string | null = null) {
  return render(
    <NoteEditorPage
      routeNoteId={routeNoteId}
      ownerId={12}
      onBack={state.onBack}
      onCreated={vi.fn()}
    />
  );
}

describe('NoteEditorPage', () => {
  afterEach(() => {
    state.session = {
      phase: 'verified',
      verifiedUserId: 12,
      ownerRevision: 0,
      verifySession: vi.fn(),
    };
    state.note = null;
    state.snapshot = {
      draft: { title: '', content: null as NoteDraft['content'] } as NoteDraft,
      phase: 'clean',
      replacementRevision: 0,
      hasUnsavedChanges: false,
      tagValidationError: null,
      knownTags: [],
      persisted: null,
      writeInFlight: false,
      outcomeUncertain: false,
      resolvingConflict: false,
      lifecycleBusy: false,
    };
    state.onBack.mockReset();
    state.prepareLifecycleMutation.mockReset().mockResolvedValue(null);
    state.lifecycleRun.mockReset().mockResolvedValue(null);
    vi.clearAllMocks();
  });

  it('starts with an empty accessible title and rich text editor without adding a fallback title', () => {
    renderEditor();
    const title = screen.getByRole('textbox', { name: 'Note title' });
    expect(title).toHaveValue('');
    expect(title).toHaveAttribute('placeholder', 'Untitled note');
    expect(screen.getByLabelText('Note content')).toBeInTheDocument();
    expect(screen.getByText('Not saved yet')).toBeInTheDocument();
  });

  it('places shared Tags after the title and stages changes in the note draft', () => {
    renderEditor();

    const title = screen.getByRole('textbox', { name: 'Note title' });
    const tags = screen.getByLabelText('Note Tags');
    const contentEditor = screen.getByLabelText('Note content');
    expect(tags).toHaveAttribute('data-user-id', '12');
    expect(tags).toHaveTextContent('Add tag');
    expect(title.compareDocumentPosition(tags) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      tags.compareDocumentPosition(contentEditor) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    expect(state.edit).toHaveBeenCalledWith({
      title: '',
      content: null,
      tags: [{ name: 'Ideas' }],
    });
  });

  it('shows dirty and saving states before a new Note is confirmed by the server', () => {
    state.snapshot = {
      ...state.snapshot,
      phase: 'dirty',
      draft: { title: 'Draft', content: null },
      hasUnsavedChanges: true,
    };
    const rendered = renderEditor();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    state.snapshot = { ...state.snapshot, phase: 'saving' };
    rendered.rerender(
      <NoteEditorPage routeNoteId={null} ownerId={12} onBack={vi.fn()} onCreated={vi.fn()} />
    );
    expect(screen.getByText('Saving…')).toBeInTheDocument();
  });

  it('passes the user-entered title as a draft without inserting a display fallback', () => {
    renderEditor();
    fireEvent.change(screen.getByRole('textbox', { name: 'Note title' }), {
      target: { value: 'A real title' },
    });
    expect(state.edit).toHaveBeenCalledWith({ title: 'A real title', content: null });
  });

  it('shows Archive and More actions only after a Note is persisted', () => {
    renderEditor();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();

    state.note = { ...archivedNote, title: 'An active note', archivedAt: null };
    state.snapshot = { ...state.snapshot, persisted: { id: 6, version: 2 } };
    renderEditor('6');
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'More actions for An active note' })
    ).toBeInTheDocument();
  });

  it('requires Trash confirmation and Cancel dispatches no lifecycle request', async () => {
    state.note = { ...archivedNote, title: 'Recoverable note' };
    state.snapshot = { ...state.snapshot, persisted: { id: 6, version: 2 } };
    renderEditor('6');
    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions for Recoverable note' }), {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to Trash' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('contents remain recoverable');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(state.prepareLifecycleMutation).not.toHaveBeenCalled();
    expect(state.lifecycleRun).not.toHaveBeenCalled();
    expect(state.onBack).not.toHaveBeenCalled();
  });

  it('allows archived notes to be edited and keeps retry visible after a save failure', () => {
    state.note = archivedNote;
    state.snapshot = {
      draft: { title: '', content },
      phase: 'failed',
      replacementRevision: 0,
      hasUnsavedChanges: true,
      tagValidationError: null,
      knownTags: [],
      persisted: { id: 6, version: 2 },
      writeInFlight: false,
      outcomeUncertain: false,
      resolvingConflict: false,
      lifecycleBusy: false,
    };
    renderEditor('6');

    expect(screen.getByRole('textbox', { name: 'Note title' })).toBeInTheDocument();
    expect(screen.getByText(/Archived/)).toBeInTheDocument();
    expect(screen.getByText('Save failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.retry).toHaveBeenCalledOnce();
  });

  it('flushes before restoring an archived note and uses the prepared server version', async () => {
    state.note = archivedNote;
    state.snapshot = {
      ...state.snapshot,
      persisted: { id: archivedNote.id, version: archivedNote.version },
    };
    state.prepareLifecycleMutation.mockResolvedValueOnce({ id: archivedNote.id, version: 7 });
    const restored = { ...archivedNote, version: 8, archivedAt: null };
    state.lifecycleRun.mockResolvedValueOnce({ kind: 'note', note: restored });
    renderEditor(String(archivedNote.id));

    fireEvent.click(screen.getByRole('button', { name: 'Restore from Archive' }));

    await waitFor(() =>
      expect(state.lifecycleRun).toHaveBeenCalledWith(
        12,
        {
          id: archivedNote.id,
          version: 7,
          archivedAt: archivedNote.archivedAt,
        },
        'restore'
      )
    );
    expect(state.prepareLifecycleMutation).toHaveBeenCalledOnce();
    expect(state.completeLifecycleMutation).toHaveBeenCalledWith(restored);
  });

  it('disables title, Tags, and content while the lifecycle preparation is pending', async () => {
    state.note = { ...archivedNote, title: 'Pending save', archivedAt: null };
    state.snapshot = {
      ...state.snapshot,
      draft: { title: 'Pending save', content },
      persisted: { id: 6, version: 2 },
    };
    let releasePreparation!: (target: { id: number; version: number } | null) => void;
    state.prepareLifecycleMutation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePreparation = resolve;
        })
    );
    renderEditor('6');

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Note title' })).toBeDisabled());
    expect(screen.getByLabelText('Note Tags')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByLabelText('Note content')).toHaveAttribute('aria-disabled', 'true');

    releasePreparation({ id: 6, version: 3 });
    await waitFor(() => expect(state.lifecycleRun).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Note title' })).toBeEnabled());
  });

  it('keeps the editor mounted after Archive and displays returned lifecycle metadata', async () => {
    state.note = { ...archivedNote, title: 'Keep editing', archivedAt: null };
    state.snapshot = {
      ...state.snapshot,
      draft: { title: 'Keep editing', content },
      persisted: { id: 6, version: 2 },
    };
    state.prepareLifecycleMutation.mockResolvedValueOnce({ id: 6, version: 3 });
    const archived = { ...state.note, version: 4, archivedAt: '2026-11-21T12:00:00Z' };
    state.lifecycleRun.mockResolvedValueOnce({ kind: 'note', note: archived });
    renderEditor('6');
    const title = screen.getByRole('textbox', { name: 'Note title' });

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Restore from Archive' })).toBeInTheDocument()
    );
    expect(screen.getByRole('textbox', { name: 'Note title' })).toBe(title);
    expect(title).toHaveValue('Keep editing');
    expect(state.completeLifecycleMutation).toHaveBeenCalledWith(archived);
  });

  it('does not dispatch after a failed save and retains the draft after lifecycle conflict', async () => {
    state.note = { ...archivedNote, title: 'Preserved draft', archivedAt: null };
    state.snapshot = {
      ...state.snapshot,
      draft: { title: 'Preserved draft', content },
      phase: 'failed',
      persisted: { id: 6, version: 2 },
      hasUnsavedChanges: true,
    };
    const failedEditor = renderEditor('6');
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(state.prepareLifecycleMutation).not.toHaveBeenCalled();
    expect(state.lifecycleRun).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveValue('Preserved draft');
    failedEditor.unmount();

    state.snapshot = { ...state.snapshot, phase: 'saved', hasUnsavedChanges: false };
    state.prepareLifecycleMutation.mockResolvedValueOnce({ id: 6, version: 2 });
    state.lifecycleRun.mockResolvedValueOnce(null);
    const rendered = renderEditor('6');
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(state.cancelLifecycleMutation).toHaveBeenCalled());
    expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveValue('Preserved draft');
    expect(state.onBack).not.toHaveBeenCalled();
    rendered.unmount();
  });

  it('navigates back only after a confirmed Trash receipt', async () => {
    state.note = { ...archivedNote, title: 'Trash me' };
    state.snapshot = { ...state.snapshot, persisted: { id: 6, version: 2 } };
    renderEditor('6');
    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions for Trash me' }), {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to Trash' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('contents remain recoverable');
    expect(state.onBack).not.toHaveBeenCalled();
    state.prepareLifecycleMutation.mockResolvedValueOnce({ id: 6, version: 2 });
    state.lifecycleRun.mockResolvedValueOnce({ kind: 'deleted' });
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }));
    await waitFor(() => expect(state.onBack).toHaveBeenCalledOnce());
    expect(state.completeLifecycleMutation).toHaveBeenCalledWith(null);
  });

  it('shows Tag validation feedback beside the Tag selector without losing the draft', () => {
    state.snapshot = {
      ...state.snapshot,
      draft: { title: 'Keep this note', content, tags: [{ id: 42 }] },
      phase: 'failed',
      tagValidationError: 'Tag no longer exists',
    };
    renderEditor();

    expect(screen.getByRole('alert')).toHaveTextContent('Tag no longer exists');
    expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveValue('Keep this note');
    expect(screen.getByLabelText('Note Tags')).toHaveTextContent('Tag 42');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('uses canonical Tag metadata published by the save coordinator', () => {
    state.snapshot = {
      ...state.snapshot,
      draft: { title: 'Tagged note', content: null, tags: [{ id: 42 }] },
      knownTags: [{ id: 42, name: 'Planning' }],
    };
    renderEditor();

    expect(screen.getByLabelText('Note Tags')).toHaveTextContent('Planning');
    expect(screen.getByLabelText('Note Tags')).not.toHaveTextContent('Tag 42');
  });

  it('requires confirmation before either conflict choice is applied', () => {
    state.note = archivedNote;
    state.snapshot = {
      draft: { title: 'Local', content },
      phase: 'conflict',
      replacementRevision: 0,
      hasUnsavedChanges: true,
      tagValidationError: null,
      knownTags: [],
      persisted: { id: 6, version: 2 },
      writeInFlight: false,
      outcomeUncertain: false,
      resolvingConflict: false,
      lifecycleBusy: false,
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
      <NoteEditorPage routeNoteId="6" ownerId={12} onBack={vi.fn()} onCreated={vi.fn()} />
    );

    expect(screen.getByLabelText('Note content')).toBe(editor);
  });

  it('closes the conflict confirmation with Escape', () => {
    state.note = archivedNote;
    state.snapshot = {
      ...state.snapshot,
      draft: { title: 'Local', content },
      phase: 'conflict',
      persisted: { id: 6, version: 2 },
      hasUnsavedChanges: true,
    };
    renderEditor('6');
    fireEvent.click(screen.getByRole('button', { name: 'Load latest version' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
