import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RichTextDocument } from '@/components/rich-text/richTextDocument';
import type { NoteDetail } from './types';
import { NoteSaveCoordinator } from './NoteSaveCoordinator';
import type { NoteDraft } from './noteDraft';

const emptyDraft: NoteDraft = { title: '', content: null };
const textDocument = (text: string): RichTextDocument => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const detail = (id: number, version: number, draft: NoteDraft): NoteDetail => ({
  id,
  title: draft.title.trim() || null,
  content: draft.content,
  version,
  inbox: false,
  archivedAt: null,
  createdAt: '2026-11-09T10:00:00Z',
  updatedAt: '2026-11-09T10:00:00Z',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const conflictError = () =>
  Object.assign(new Error('version conflict'), { response: { status: 409 } });

afterEach(() => vi.useRealTimers());

describe('NoteSaveCoordinator', () => {
  it('does not create a Note for an untouched new draft', async () => {
    const create = vi.fn();
    const coordinator = new NoteSaveCoordinator({
      initialDraft: emptyDraft,
      initialNote: null,
      transport: { create, update: vi.fn(), get: vi.fn() },
      onChange: vi.fn(),
      debounceMs: 900,
    });

    await coordinator.flush();

    expect(create).not.toHaveBeenCalled();
    expect(coordinator.snapshot().hasUnsavedChanges).toBe(false);
    coordinator.dispose();
  });

  it('creates meaningful content after the idle debounce', async () => {
    vi.useFakeTimers();
    const create = vi.fn().mockResolvedValue(detail(4, 0, { title: 'First note', content: null }));
    const coordinator = new NoteSaveCoordinator({
      initialDraft: emptyDraft,
      initialNote: null,
      transport: { create, update: vi.fn(), get: vi.fn() },
      onChange: vi.fn(),
      debounceMs: 900,
    });

    coordinator.edit({ title: 'First note', content: null });
    await vi.advanceTimersByTimeAsync(899);
    expect(create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toEqual({ title: 'First note', content: null });
    expect(create.mock.calls[0]?.[1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(coordinator.snapshot().phase).toBe('saved');
    coordinator.dispose();
  });

  it('serializes edits made during creation into one versioned update without replacing the draft', async () => {
    vi.useFakeTimers();
    const createRequest = deferred<NoteDetail>();
    const create = vi.fn(() => createRequest.promise);
    const update = vi
      .fn()
      .mockResolvedValue(
        detail(4, 1, { title: 'First note', content: textDocument('Latest body') })
      );
    const coordinator = new NoteSaveCoordinator({
      initialDraft: emptyDraft,
      initialNote: null,
      transport: { create, update, get: vi.fn() },
      onChange: vi.fn(),
      debounceMs: 10,
    });

    coordinator.edit({ title: 'First note', content: null });
    await vi.advanceTimersByTimeAsync(10);
    expect(create).toHaveBeenCalledOnce();

    const latest = { title: 'First note', content: textDocument('Latest body') };
    coordinator.edit(latest);
    await vi.advanceTimersByTimeAsync(10);
    expect(update).not.toHaveBeenCalled();

    createRequest.resolve(detail(4, 0, { title: 'First note', content: null }));
    await vi.advanceTimersByTimeAsync(0);

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(4, {
      expectedVersion: 0,
      title: 'First note',
      content: latest.content,
    });
    expect(coordinator.snapshot().draft).toEqual(latest);
    expect(coordinator.snapshot().phase).toBe('saved');
    coordinator.dispose();
  });

  it('reconciles a committed update whose response was lost', async () => {
    vi.useFakeTimers();
    const saved = { title: 'Existing', content: textDocument('Committed') };
    const current = detail(7, 3, { title: 'Existing', content: null });
    const update = vi.fn().mockRejectedValue(new Error('response lost'));
    const get = vi.fn().mockResolvedValue(detail(7, 4, saved));
    const coordinator = new NoteSaveCoordinator({
      initialDraft: { title: 'Existing', content: null },
      initialNote: current,
      transport: { create: vi.fn(), update, get },
      onChange: vi.fn(),
      debounceMs: 10,
    });

    coordinator.edit(saved);
    await vi.advanceTimersByTimeAsync(10);

    expect(update).toHaveBeenCalledWith(7, {
      expectedVersion: 3,
      title: 'Existing',
      content: saved.content,
    });
    expect(get).toHaveBeenCalledWith(7);
    expect(coordinator.snapshot()).toMatchObject({
      persisted: { id: 7, version: 4 },
      phase: 'saved',
      hasUnsavedChanges: false,
    });
    coordinator.dispose();
  });

  it('collapses rapid edits and sends the newest nullable title with the confirmed version', async () => {
    vi.useFakeTimers();
    const initial: NoteDraft = { title: 'Existing', content: null };
    const update = vi.fn().mockResolvedValue(detail(7, 6, { title: '', content: null }));
    const coordinator = new NoteSaveCoordinator({
      initialDraft: initial,
      initialNote: detail(7, 5, initial),
      transport: { create: vi.fn(), update, get: vi.fn() },
      onChange: vi.fn(),
      debounceMs: 20,
    });

    coordinator.edit({ title: 'Intermediate', content: null });
    await vi.advanceTimersByTimeAsync(10);
    coordinator.edit({ title: '', content: null });
    await vi.advanceTimersByTimeAsync(20);

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(7, {
      expectedVersion: 5,
      title: null,
      content: null,
    });
    expect(coordinator.snapshot()).toMatchObject({
      persisted: { id: 7, version: 6 },
      phase: 'saved',
    });
    coordinator.dispose();
  });

  it('keeps an unchanged-version update retryable without retrying automatically', async () => {
    vi.useFakeTimers();
    const initial: NoteDraft = { title: 'Existing', content: null };
    const changed: NoteDraft = { title: 'Existing', content: textDocument('Draft') };
    const update = vi
      .fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(detail(7, 2, changed));
    const get = vi.fn().mockResolvedValue(detail(7, 1, initial));
    const coordinator = new NoteSaveCoordinator({
      initialDraft: initial,
      initialNote: detail(7, 1, initial),
      transport: { create: vi.fn(), update, get },
      onChange: vi.fn(),
      debounceMs: 10,
    });

    coordinator.edit(changed);
    await vi.advanceTimersByTimeAsync(10);
    expect(coordinator.snapshot().phase).toBe('failed');
    expect(update).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(100);
    expect(update).toHaveBeenCalledOnce();
    await coordinator.retry();

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]).toEqual(update.mock.calls[0]);
    expect(coordinator.snapshot()).toMatchObject({
      persisted: { id: 7, version: 2 },
      phase: 'saved',
    });
    coordinator.dispose();
  });

  it('does not send a no-op update for an existing note', async () => {
    const initial: NoteDraft = { title: 'Existing', content: null };
    const update = vi.fn();
    const coordinator = new NoteSaveCoordinator({
      initialDraft: initial,
      initialNote: detail(7, 1, initial),
      transport: { create: vi.fn(), update, get: vi.fn() },
      onChange: vi.fn(),
    });

    coordinator.edit({ title: ' Existing ', content: null });
    await coordinator.flush();

    expect(update).not.toHaveBeenCalled();
    expect(coordinator.snapshot().phase).toBe('saved');
    coordinator.dispose();
  });

  it('reuses the frozen idempotency key and body when retrying a failed create', async () => {
    vi.useFakeTimers();
    const first = { title: 'First', content: null };
    const latest = { title: 'First', content: textDocument('Later edit') };
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('unknown create outcome'))
      .mockResolvedValueOnce(detail(8, 0, first));
    const update = vi.fn().mockResolvedValue(detail(8, 1, latest));
    const coordinator = new NoteSaveCoordinator({
      initialDraft: emptyDraft,
      initialNote: null,
      transport: { create, update, get: vi.fn() },
      onChange: vi.fn(),
      debounceMs: 10,
    });

    coordinator.edit(first);
    await vi.advanceTimersByTimeAsync(10);
    expect(coordinator.snapshot().phase).toBe('failed');
    coordinator.edit(latest);
    await vi.advanceTimersByTimeAsync(100);
    expect(create).toHaveBeenCalledOnce();
    await coordinator.retry();

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
    expect(update).toHaveBeenCalledWith(8, {
      expectedVersion: 0,
      title: 'First',
      content: latest.content,
    });
    expect(coordinator.snapshot().phase).toBe('saved');
    coordinator.dispose();
  });

  it('serializes a newer edit after an in-flight update using its returned version', async () => {
    vi.useFakeTimers();
    const initial = { title: 'Existing', content: null };
    const first = { title: 'Existing', content: textDocument('First change') };
    const latest = { title: 'Existing', content: textDocument('Latest change') };
    const firstRequest = deferred<NoteDetail>();
    const update = vi
      .fn()
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce(detail(7, 3, latest));
    const coordinator = new NoteSaveCoordinator({
      initialDraft: initial,
      initialNote: detail(7, 1, initial),
      transport: { create: vi.fn(), update, get: vi.fn() },
      onChange: vi.fn(),
      debounceMs: 10,
    });

    coordinator.edit(first);
    await vi.advanceTimersByTimeAsync(10);
    expect(update).toHaveBeenCalledOnce();
    coordinator.edit(latest);
    await vi.advanceTimersByTimeAsync(10);
    expect(update).toHaveBeenCalledOnce();

    firstRequest.resolve(detail(7, 2, first));
    await vi.advanceTimersByTimeAsync(0);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]).toEqual([
      7,
      { expectedVersion: 2, title: 'Existing', content: latest.content },
    ]);
    expect(coordinator.snapshot()).toMatchObject({
      draft: latest,
      persisted: { id: 7, version: 3 },
      phase: 'saved',
    });
    coordinator.dispose();
  });

  it('pauses autosave after 409 and keeps edits made while conflicted local', async () => {
    vi.useFakeTimers();
    const initial = { title: 'Existing', content: null };
    const first = { title: 'Existing', content: textDocument('First draft') };
    const latest = { title: 'Existing', content: textDocument('Latest draft') };
    const update = vi.fn().mockRejectedValue(conflictError());
    const coordinator = new NoteSaveCoordinator({
      initialDraft: initial,
      initialNote: detail(9, 2, initial),
      transport: { create: vi.fn(), update, get: vi.fn() },
      onChange: vi.fn(),
      debounceMs: 10,
    });

    coordinator.edit(first);
    await vi.advanceTimersByTimeAsync(10);
    expect(coordinator.snapshot().phase).toBe('conflict');
    coordinator.edit(latest);
    await vi.advanceTimersByTimeAsync(100);

    expect(update).toHaveBeenCalledOnce();
    expect(coordinator.snapshot()).toMatchObject({ draft: latest, phase: 'conflict' });
    coordinator.dispose();
  });

  it('keeps the newest local version against a fresh server version after confirmation', async () => {
    vi.useFakeTimers();
    const initial = { title: 'Existing', content: null };
    const first = { title: 'Existing', content: textDocument('First draft') };
    const latest = { title: 'Existing', content: textDocument('Latest draft') };
    const update = vi
      .fn()
      .mockRejectedValueOnce(conflictError())
      .mockResolvedValueOnce(detail(9, 4, latest));
    const get = vi.fn().mockResolvedValue(detail(9, 3, { title: 'Server edit', content: null }));
    const coordinator = new NoteSaveCoordinator({
      initialDraft: initial,
      initialNote: detail(9, 2, initial),
      transport: { create: vi.fn(), update, get },
      onChange: vi.fn(),
      debounceMs: 10,
    });

    coordinator.edit(first);
    await vi.advanceTimersByTimeAsync(10);
    coordinator.edit(latest);
    await coordinator.resolveConflict('keep-local');

    expect(get).toHaveBeenCalledWith(9);
    expect(update).toHaveBeenLastCalledWith(9, {
      expectedVersion: 3,
      title: 'Existing',
      content: latest.content,
    });
    expect(coordinator.snapshot()).toMatchObject({
      draft: latest,
      persisted: { id: 9, version: 4 },
      phase: 'saved',
    });
    coordinator.dispose();
  });

  it('loads the server version only after a successful explicit resolution', async () => {
    const local = { title: 'Local', content: textDocument('Unsaved') };
    const server = { title: 'Server', content: textDocument('Current') };
    const get = vi.fn().mockResolvedValue(detail(9, 6, server));
    const coordinator = new NoteSaveCoordinator({
      initialDraft: local,
      initialNote: detail(9, 5, { title: 'Old', content: null }),
      transport: { create: vi.fn(), update: vi.fn().mockRejectedValue(conflictError()), get },
      onChange: vi.fn(),
    });
    coordinator.edit(local);
    await coordinator.flush();
    expect(coordinator.snapshot().phase).toBe('conflict');

    await coordinator.resolveConflict('load-server');

    expect(get).toHaveBeenCalledWith(9);
    expect(coordinator.snapshot()).toMatchObject({
      draft: server,
      persisted: { id: 9, version: 6 },
      phase: 'saved',
      hasUnsavedChanges: false,
      replacementRevision: 1,
    });
    coordinator.dispose();
  });

  it('preserves the local draft when the confirmed server reload fails', async () => {
    const local = { title: 'Local', content: textDocument('Unsaved') };
    const get = vi.fn().mockRejectedValue(new Error('unavailable'));
    const coordinator = new NoteSaveCoordinator({
      initialDraft: local,
      initialNote: detail(9, 5, { title: 'Old', content: null }),
      transport: { create: vi.fn(), update: vi.fn().mockRejectedValue(conflictError()), get },
      onChange: vi.fn(),
    });
    coordinator.edit(local);
    await coordinator.flush();

    await coordinator.resolveConflict('load-server');

    expect(coordinator.snapshot()).toMatchObject({ draft: local, phase: 'conflict' });
    coordinator.dispose();
  });

  it('keeps the draft and returns to conflict after a repeated Keep my version conflict', async () => {
    vi.useFakeTimers();
    const initial = { title: 'Existing', content: null };
    const local = { title: 'Existing', content: textDocument('Keep this draft') };
    const update = vi.fn().mockRejectedValue(conflictError());
    const get = vi.fn().mockResolvedValue(detail(9, 6, { title: 'Other version', content: null }));
    const coordinator = new NoteSaveCoordinator({
      initialDraft: initial,
      initialNote: detail(9, 5, initial),
      transport: { create: vi.fn(), update, get },
      onChange: vi.fn(),
      debounceMs: 10,
    });

    coordinator.edit(local);
    await vi.advanceTimersByTimeAsync(10);
    await coordinator.resolveConflict('keep-local');

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(9, {
      expectedVersion: 6,
      title: 'Existing',
      content: local.content,
    });
    expect(coordinator.snapshot()).toMatchObject({ draft: local, phase: 'conflict' });
    coordinator.dispose();
  });
});
