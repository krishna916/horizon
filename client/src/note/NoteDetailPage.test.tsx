import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { noteApi } from './api';
import { NoteDetailPage } from './NoteDetailPage';
import { NoteNewPlaceholder } from './NoteNewPlaceholder';
import type { NoteDetail } from './types';

const session = vi.hoisted(() => ({
  value: { phase: 'verified', verifiedUserId: 1, verifySession: vi.fn() },
}));

vi.mock('@/user/session/AuthSessionProvider', () => ({
  useAuthSession: () => session.value,
}));

const content = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A read-only thought.' }] }],
};

function detail(overrides: Partial<NoteDetail> = {}): AxiosResponse<NoteDetail> {
  return {
    data: {
      id: 7,
      title: 'Trip notes',
      content,
      version: 1,
      inbox: false,
      archivedAt: null,
      createdAt: '2026-11-08T10:00:00Z',
      updatedAt: '2026-11-09T10:00:00Z',
      ...overrides,
    },
  } as AxiosResponse<NoteDetail>;
}

function renderDetail(rawId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<NoteDetailPage rawId={rawId} onBack={vi.fn()} />, { wrapper: Wrapper });
}

describe('NoteDetailPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    session.value = { phase: 'verified', verifiedUserId: 1, verifySession: vi.fn() };
  });

  it('loads a full note once and renders read-only content with a fallback title', async () => {
    const getSpy = vi.spyOn(noteApi, 'get').mockResolvedValue(detail({ title: '  ' }));
    renderDetail('7');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Untitled note' })).toBeInTheDocument()
    );
    expect(screen.getByLabelText('Note content')).toHaveTextContent('A read-only thought.');
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(7, expect.any(AbortSignal));
    expect(document.querySelector('input, textarea')).toBeNull();
    expect(screen.getByRole('button', { name: 'Back to Notes' })).toBeInTheDocument();
  });

  it.each(['0', 'abc', '-1', '9007199254740992'])(
    'rejects invalid route ID %s without a request',
    async (rawId) => {
      const getSpy = vi.spyOn(noteApi, 'get');
      renderDetail(rawId);

      expect(await screen.findByRole('heading', { name: 'Note unavailable' })).toBeInTheDocument();
      expect(getSpy).not.toHaveBeenCalled();
    }
  );

  it('shows the same unavailable state for a missing or inaccessible note', async () => {
    vi.spyOn(noteApi, 'get').mockRejectedValue(
      Object.assign(new AxiosError('Not found'), { response: { status: 404 } })
    );
    renderDetail('7');

    expect(await screen.findByRole('heading', { name: 'Note unavailable' })).toBeInTheDocument();
    expect(screen.queryByText(/owner|permission|user 1/i)).toBeNull();
  });

  it('shows a non-leaky retry for transient server failures', async () => {
    vi.spyOn(noteApi, 'get').mockRejectedValue(new Error('sensitive server details'));
    renderDetail('7');

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load this note/i);
    expect(screen.queryByText('sensitive server details')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('keeps archived notes readable without lifecycle or editing controls', async () => {
    vi.spyOn(noteApi, 'get').mockResolvedValue(detail({ archivedAt: '2026-11-08T11:00:00Z' }));
    renderDetail('7');

    expect(await screen.findByRole('heading', { name: 'Trip notes' })).toBeInTheDocument();
    expect(screen.getByText(/archived/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit|archive|delete/i })).toBeNull();
  });
});

describe('NoteNewPlaceholder', () => {
  it('explains the next step and links back without creating a note', () => {
    const getSpy = vi.spyOn(noteApi, 'get');
    render(<NoteNewPlaceholder onBack={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Note editor coming next' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Notes' })).toBeInTheDocument();
    expect(getSpy).not.toHaveBeenCalled();
  });
});
