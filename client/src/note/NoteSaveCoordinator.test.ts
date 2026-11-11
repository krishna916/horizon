import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RichTextDocument } from '@/components/rich-text/richTextDocument';
import type { NoteDetail } from './types';
import { NoteSaveCoordinator } from './NoteSaveCoordinator';
import { noteDraftMatchesNote } from './noteDraft';
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
  tags: [],
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
  it('exposes Tag validation errors from create responses for a manual retry', async () => {
    const create = vi.fn().mockRejectedValue(
      Object.assign(new Error('invalid'), {
        response: { status: 400, data: { errors: { tags: ['Tag name is too long'] } } },
      })
    );
    const draft = { title: 'Keep this', content: null, tags: [{ name: 'Planning' }] };
    const coordinator = new NoteSaveCoordinator({
      initialDraft: draft,
      initialNote: null,
      transport: { create, update: vi.fn(), get: vi.fn() },
      onChange: vi.fn(),
    });

    coordinator.edit(draft);
    await coordinator.flush();

    expect(coordinator.snapshot()).toMatchObject({
      phase: 'failed',
      draft,
      tagValidationError: 'Tag name is too long',
    });
    expect(create).toHaveBeenCalledOnce();
    coordinator.dispose();
  });

  it('exposes Tag validation errors from update responses and leaves other 400 fields generic', async () => {
    const initial = { title: 'Keep this', content: null, tags: [] as { id: number }[] };
    const draft = { ...initial, tags: [{ id: 42 }] };
    const update = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('invalid tags'), {
          response: { status: 400, data: { errors: { tags: ['Tag no longer exists'] } } },
        })
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('invalid content'), {
          response: { status: 400, data: { errors: { content: ['Invalid content'] } } },
        })
      )
      .mockResolvedValueOnce({
        ...detail(7, 2, { ...draft, title: 'Still here' }),
        tags: [{ id: 42, name: 'Planning' }],
      });
    const coordinator = new NoteSaveCoordinator({
      initialDraft: initial,
      initialNote: detail(7, 1, initial),
      transport: { create: vi.fn(), update, get: vi.fn() },
      onChange: vi.fn(),
    });

    coordinator.edit(draft);
    await coordinator.flush();
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'failed',
      draft,
      tagValidationError: 'Tag no longer exists',
    });

    coordinator.edit({ ...draft, title: 'Still here' });
    expect(update).toHaveBeenCalledOnce();
    await coordinator.retry();
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'failed',
      tagValidationError: null,
    });
    expect(update).toHaveBeenCalledTimes(2);

    await coordinator.retry();
    expect(coordinator.snapshot()).toMatchObject({ phase: 'saved', tagValidationError: null });
    expect(update).toHaveBeenCalledTimes(3);
    coordinator.dispose();
  });

  it('uses safe copy when a Tag validation response has no usable field message', async () => {
    const create = vi.fn().mockRejectedValue(
      Object.assign(new Error('invalid'), {
        response: { status: 400, data: { errors: { tags: [42] } } },
      })
    );
    const draft = { title: 'Keep this', content: null, tags: [{ name: 'Planning' }] };
    const coordinator = new NoteSaveCoordinator({
      initialDraft: draft,
      initialNote: null,
      transport: { create, update: vi.fn(), get: vi.fn() },
      onChange: vi.fn(),
    });

    coordinator.edit(draft);
    await coordinator.flush();

    expect(coordinator.snapshot().tagValidationError).toBe(
      'Some selected tags could not be saved. Review your tags and try again.'
    );
    coordinator.dispose();
  });

  it('matches a name selection only to one canonical server Tag', () => {
    const selected: NoteDraft = {
      title: 'Existing',
      content: null,
      tags: [{ name: ' Planning ' }],
    };
    const canonical = {
      ...detail(7, 2, selected),
      tags: [{ id: 42, name: 'Planning' }],
    };
    const missing = { ...canonical, tags: [] };
    const ambiguous = {
      ...canonical,
      tags: [
        { id: 42, name: 'Planning' },
        { id: 43, name: 'planning' },
      ],
    };

    expect(noteDraftMatchesNote(selected, canonical)).toBe(true);
    expect(noteDraftMatchesNote(selected, missing)).toBe(false);
    expect(noteDraftMatchesNote(selected, ambiguous)).toBe(false);
  });

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

  it('keeps a tag-only new draft staged without treating it as a save or creating a Note', async () => {
    const create = vi.fn();
    const coordinator = new NoteSaveCoordinator({
      initialDraft: emptyDraft,
      initialNote: null,
      transport: { create, update: vi.fn(), get: vi.fn() },
      onChange: vi.fn(),
    });

    coordinator.edit({ ...emptyDraft, tags: [{ name: 'Planning' }] });
    expect(coordinator.snapshot()).toMatchObject({
      hasTagOnlyDraft: true,
      hasUnsavedChanges: false,
    });
    await coordinator.flush();

    expect(create).not.toHaveBeenCalled();
    expect(coordinator.snapshot()).toMatchObject({ phase: 'clean', hasTagOnlyDraft: true });
    coordinator.dispose();
  });

  it('reports an issued write separately from unsent debounce work', async () => {
    const initial = { title: 'Existing', content: null };
    const edited = { title: 'Changed', content: null };
    const pending = deferred<NoteDetail>();
    const update = vi.fn().mockReturnValue(pending.promise);
    const coordinator = new NoteSaveCoordinator({
      initialDraft: initial,
      initialNote: detail(7, 2, initial),
      transport: { create: vi.fn(), update, get: vi.fn() },
      onChange: vi.fn(),
    });

    coordinator.edit(edited);
    expect(coordinator.snapshot()).toMatchObject({ writeInFlight: false, outcomeUncertain: false });
    const saving = coordinator.flush();
    await Promise.resolve();
    expect(coordinator.snapshot()).toMatchObject({ writeInFlight: true, outcomeUncertain: false });

    pending.resolve(detail(7, 3, edited));
    await saving;
    expect(coordinator.snapshot()).toMatchObject({ writeInFlight: false, outcomeUncertain: false });
    coordinator.dispose();
  });

  it('holds queued changes while a navigation decision is open and resumes them on release', async () => {
    vi.useFakeTimers();
    const update = vi.fn().mockResolvedValue(detail(7, 3, { title: 'Changed', content: null }));
    const coordinator = new NoteSaveCoordinator({
      initialDraft: { title: 'Existing', content: null },
      initialNote: detail(7, 2, { title: 'Existing', content: null }),
      transport: { create: vi.fn(), update, get: vi.fn() },
      onChange: vi.fn(),
      debounceMs: 900,
    });

    coordinator.edit({ title: 'Changed', content: null });
    coordinator.holdQueuedWritesForNavigation();
    await vi.advanceTimersByTimeAsync(1800);
    expect(update).not.toHaveBeenCalled();

    coordinator.releaseQueuedWritesForNavigation();
    await vi.advanceTimersByTimeAsync(899);
    expect(update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(update).toHaveBeenCalledOnce();
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'saved',
      persisted: { id: 7, version: 3 },
    });
    coordinator.dispose();
  });

  it('processes an issued acknowledgement while holding and does not dispatch edits queued during the hold', async () => {
    vi.useFakeTimers();
    const firstDraft = { title: 'First change', content: null };
    const secondDraft = { title: 'Second change', content: null };
    const issued = deferred<NoteDetail>();
    const update = vi
      .fn()
      .mockReturnValueOnce(issued.promise)
      .mockResolvedValueOnce(detail(7, 4, secondDraft));
    const coordinator = new NoteSaveCoordinator({
      initialDraft: { title: 'Existing', content: null },
      initialNote: detail(7, 2, { title: 'Existing', content: null }),
      transport: { create: vi.fn(), update, get: vi.fn() },
      onChange: vi.fn(),
      debounceMs: 900,
    });

    coordinator.edit(firstDraft);
    const saving = coordinator.flush();
    await Promise.resolve();
    expect(update).toHaveBeenCalledOnce();

    coordinator.holdQueuedWritesForNavigation();
    coordinator.edit(secondDraft);
    await vi.advanceTimersByTimeAsync(1800);
    issued.resolve(detail(7, 3, firstDraft));
    await saving;

    expect(update).toHaveBeenCalledOnce();
    expect(coordinator.snapshot()).toMatchObject({
      draft: secondDraft,
      persisted: { id: 7, version: 3 },
      phase: 'dirty',
      writeInFlight: false,
    });

    coordinator.releaseQueuedWritesForNavigation();
    await vi.advanceTimersByTimeAsync(900);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(7, {
      expectedVersion: 3,
      title: 'Second change',
      content: null,
      tags: [],
    });
    coordinator.dispose();
  });

  it('marks a restored frozen create uncertain and replays its exact key and body before newer edits', async () => {
    vi.useFakeTimers();
    const originalDraft = { title: 'Original title', content: null };
    const newerDraft = { title: 'Edited after recovery', content: textDocument('Newer body') };
    const originalBody = { title: 'Original title', content: null, tags: [] };
    const originalKey = 'original-create-key';
    const create = vi.fn().mockResolvedValue(detail(501, 0, originalDraft));
    const update = vi.fn().mockResolvedValue(detail(501, 1, newerDraft));
    const coordinator = new NoteSaveCoordinator({
      initialDraft: originalDraft,
      initialNote: null,
      recovery: { frozenCreateRequest: { body: originalBody, key: originalKey } },
      transport: { create, update, get: vi.fn() },
      onChange: vi.fn(),
      debounceMs: 900,
    });

    expect(coordinator.snapshot()).toMatchObject({ outcomeUncertain: true, persisted: null });
    coordinator.edit(newerDraft);
    await vi.advanceTimersByTimeAsync(900);

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(originalBody, originalKey);
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(501, {
      expectedVersion: 0,
      title: newerDraft.title,
      content: newerDraft.content,
      tags: [],
    });
    expect(coordinator.snapshot()).toMatchObject({
      draft: newerDraft,
      phase: 'saved',
      outcomeUncertain: false,
      persisted: { id: 501, version: 1 },
    });
    coordinator.dispose();
  });

  it('does not replay an uncertain frozen create when the live owner gate rejects dispatch', async () => {
    const create = vi.fn();
    const coordinator = new NoteSaveCoordinator({
      initialDraft: { title: 'Original title', content: null },
      initialNote: null,
      recovery: {
        frozenCreateRequest: {
          body: { title: 'Original title', content: null, tags: [] },
          key: 'original-create-key',
        },
      },
      transport: { create, update: vi.fn(), get: vi.fn() },
      onChange: vi.fn(),
      canDispatch: () => false,
    });

    await coordinator.flush();

    expect(create).not.toHaveBeenCalled();
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'paused',
      outcomeUncertain: true,
      persisted: null,
    });
    coordinator.dispose();
  });

  it('reconciles a previously issued PATCH after same-owner recovery', async () => {
    const original = { title: 'Existing', content: null };
    const local = { title: 'Existing', content: textDocument('In flight') };
    const dispatched = deferred<NoteDetail>();
    const first = new NoteSaveCoordinator({
      initialDraft: original,
      initialNote: detail(7, 2, original),
      transport: {
        create: vi.fn(),
        update: vi.fn().mockReturnValue(dispatched.promise),
        get: vi.fn(),
      },
      onChange: vi.fn(),
    });
    first.edit(local);
    const saving = first.flush();
    await Promise.resolve();
    dispatched.reject(Object.assign(new Error('expired'), { response: { status: 401 } }));
    await saving;
    const recovery = first.recoverySnapshot();
    expect(recovery.frozenUpdateRequest).toMatchObject({
      id: 7,
      body: { expectedVersion: 2 },
      draft: local,
    });
    first.dispose();

    const committed = detail(7, 3, local);
    const get = vi.fn().mockResolvedValue(committed);
    const update = vi.fn();
    const resumed = new NoteSaveCoordinator({
      initialDraft: local,
      initialNote: committed,
      recovery,
      transport: { create: vi.fn(), update, get },
      onChange: vi.fn(),
    });
    await resumed.resume();

    expect(get).toHaveBeenCalledWith(7);
    expect(update).not.toHaveBeenCalled();
    expect(resumed.snapshot()).toMatchObject({ phase: 'saved', persisted: { id: 7, version: 3 } });
    resumed.dispose();
  });

  it('does not dispatch a save when the live session is no longer authorized', async () => {
    const update = vi.fn();
    const coordinator = new NoteSaveCoordinator({
      initialDraft: { title: 'Old', content: null },
      initialNote: detail(7, 2, { title: 'Old', content: null }),
      transport: { create: vi.fn(), update, get: vi.fn() },
      onChange: vi.fn(),
      canDispatch: () => false,
    });
    coordinator.edit({ title: 'Changed', content: null });
    await coordinator.flush();

    expect(update).not.toHaveBeenCalled();
    expect(coordinator.snapshot()).toMatchObject({ phase: 'paused', hasUnsavedChanges: true });
    coordinator.dispose();
  });

  it('requires an explicit conflict choice when recovery finds a different server write', async () => {
    const local = { title: 'Local pending', content: textDocument('Mine') };
    const remote = { title: 'Remote', content: textDocument('Theirs') };
    const frozenUpdateRequest = {
      id: 7,
      body: { expectedVersion: 2, title: 'Local pending', content: local.content, tags: [] },
      draft: local,
      revision: 1,
    };
    const coordinator = new NoteSaveCoordinator({
      initialDraft: local,
      initialNote: detail(7, 3, remote),
      recovery: {
        persistedVersion: { id: 7, version: 2 },
        frozenUpdateRequest,
      },
      transport: {
        create: vi.fn(),
        update: vi.fn(),
        get: vi.fn().mockResolvedValue(detail(7, 3, remote)),
      },
      onChange: vi.fn(),
    });
    await coordinator.resume();

    expect(coordinator.snapshot()).toMatchObject({ draft: local, phase: 'conflict' });
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
    expect(create.mock.calls[0]?.[0]).toEqual({ title: 'First note', content: null, tags: [] });
    expect(create.mock.calls[0]?.[1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(coordinator.snapshot().phase).toBe('saved');
    coordinator.dispose();
  });

  it('uses canonical Tags from a successful create without issuing a redundant PATCH', async () => {
    const draft: NoteDraft = {
      title: 'First note',
      content: null,
      tags: [{ name: 'Planning' }],
    };
    const created = {
      ...detail(4, 0, draft),
      tags: [{ id: 42, name: 'Planning' }],
    };
    const create = vi.fn().mockResolvedValue(created);
    const update = vi.fn();
    const coordinator = new NoteSaveCoordinator({
      initialDraft: emptyDraft,
      initialNote: null,
      transport: { create, update, get: vi.fn() },
      onChange: vi.fn(),
    });

    coordinator.edit(draft);
    await coordinator.flush();

    expect(create).toHaveBeenCalledWith(
      { title: 'First note', content: null, tags: [{ name: 'Planning' }] },
      expect.any(String)
    );
    expect(update).not.toHaveBeenCalled();
    expect(coordinator.snapshot()).toMatchObject({ phase: 'saved', hasUnsavedChanges: false });
    expect(coordinator.snapshot().draft.tags).toEqual([{ id: 42 }]);
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
      tags: [],
    });
    expect(coordinator.snapshot().draft).toEqual({ ...latest, tags: [] });
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
      tags: [],
    });
    expect(get).toHaveBeenCalledWith(7);
    expect(coordinator.snapshot()).toMatchObject({
      persisted: { id: 7, version: 4 },
      phase: 'saved',
      hasUnsavedChanges: false,
    });
    coordinator.dispose();
  });

  it('reconciles a lost name-tag PATCH response against its canonical server Tag', async () => {
    vi.useFakeTimers();
    const initial: NoteDraft = { title: 'Existing', content: null, tags: [] };
    const selected: NoteDraft = {
      ...initial,
      tags: [{ name: 'Planning' }],
    };
    const saved = {
      ...detail(7, 2, selected),
      tags: [{ id: 42, name: 'Planning' }],
    };
    const update = vi.fn().mockRejectedValue(new Error('response lost'));
    const get = vi.fn().mockResolvedValue(saved);
    const coordinator = new NoteSaveCoordinator({
      initialDraft: initial,
      initialNote: detail(7, 1, initial),
      transport: { create: vi.fn(), update, get },
      onChange: vi.fn(),
      debounceMs: 10,
    });

    coordinator.edit(selected);
    await vi.advanceTimersByTimeAsync(10);

    expect(update).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith(7);
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'saved',
      persisted: { id: 7, version: 2 },
      hasUnsavedChanges: false,
    });
    expect(coordinator.snapshot().draft.tags).toEqual([{ id: 42 }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(update).toHaveBeenCalledOnce();
    coordinator.dispose();
  });

  it('reconciles a frozen name-tag PATCH after same-owner recovery', async () => {
    const local: NoteDraft = {
      title: 'Existing',
      content: null,
      tags: [{ name: 'Planning' }],
    };
    const committed = {
      ...detail(7, 3, local),
      tags: [{ id: 42, name: 'Planning' }],
    };
    const recovery = {
      persistedVersion: { id: 7, version: 2 },
      frozenUpdateRequest: {
        id: 7,
        body: { expectedVersion: 2, title: 'Existing', content: null, tags: [{ name: 'Planning' }] },
        draft: local,
        revision: 1,
      },
    };
    const update = vi.fn();
    const coordinator = new NoteSaveCoordinator({
      initialDraft: local,
      initialNote: committed,
      recovery,
      transport: { create: vi.fn(), update, get: vi.fn().mockResolvedValue(committed) },
      onChange: vi.fn(),
    });

    await coordinator.resume();

    expect(update).not.toHaveBeenCalled();
    expect(coordinator.snapshot()).toMatchObject({ phase: 'saved', persisted: { id: 7, version: 3 } });
    expect(coordinator.snapshot().draft.tags).toEqual([{ id: 42 }]);
    coordinator.dispose();
  });

  it('keeps canonical-equivalent Tag selections while resolving a real content conflict', async () => {
    const local: NoteDraft = {
      title: 'Local title',
      content: null,
      tags: [{ name: 'Planning' }],
    };
    const latest = {
      ...detail(7, 3, { ...local, title: 'Remote title' }),
      tags: [{ id: 42, name: 'Planning' }],
    };
    const update = vi.fn().mockResolvedValue({
      ...detail(7, 4, local),
      tags: [{ id: 42, name: 'Planning' }],
    });
    const coordinator = new NoteSaveCoordinator({
      initialDraft: local,
      initialNote: latest,
      recovery: { persistedVersion: { id: 7, version: 2 } },
      transport: { create: vi.fn(), update, get: vi.fn().mockResolvedValue(latest) },
      onChange: vi.fn(),
    });

    expect(coordinator.snapshot().phase).toBe('conflict');
    await coordinator.resolveConflict('keep-local');

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(7, {
      expectedVersion: 3,
      title: 'Local title',
      content: null,
      tags: [{ id: 42 }],
    });
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'saved',
      persisted: { id: 7, version: 4 },
      hasUnsavedChanges: false,
    });
    expect(coordinator.snapshot().draft.tags).toEqual([{ id: 42 }]);
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
      tags: [],
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
      tags: [],
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
    await vi.advanceTimersByTimeAsync(10);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]).toEqual([
      7,
      { expectedVersion: 2, title: 'Existing', content: latest.content, tags: [] },
    ]);
    expect(coordinator.snapshot()).toMatchObject({
      draft: latest,
      persisted: { id: 7, version: 3 },
      phase: 'saved',
    });
    coordinator.dispose();
  });

  it('preserves newer Tag edits and sends one canonical versioned PATCH after acknowledgement', async () => {
    vi.useFakeTimers();
    const initial: NoteDraft = { title: 'Existing', content: null, tags: [] };
    const first: NoteDraft = { ...initial, tags: [{ name: 'Planning' }] };
    const latest: NoteDraft = {
      title: 'Edited while saving',
      content: null,
      tags: [{ name: 'Planning' }, { name: 'Later' }],
    };
    const issued = deferred<NoteDetail>();
    const update = vi
      .fn()
      .mockReturnValueOnce(issued.promise)
      .mockResolvedValueOnce({
        ...detail(7, 3, latest),
        tags: [
          { id: 42, name: 'Planning' },
          { id: 43, name: 'Later' },
        ],
      });
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
    issued.resolve({ ...detail(7, 2, first), tags: [{ id: 42, name: 'Planning' }] });
    await vi.advanceTimersByTimeAsync(10);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]).toEqual([
      7,
      {
        expectedVersion: 2,
        title: 'Edited while saving',
        content: null,
        tags: [{ id: 42 }, { name: 'Later' }],
      },
    ]);
    expect(coordinator.snapshot()).toMatchObject({
      draft: { title: 'Edited while saving', tags: [{ id: 42 }, { id: 43 }] },
      phase: 'saved',
      persisted: { id: 7, version: 3 },
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
      tags: [],
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

  it('keeps edits made during confirmed Load latest and remains in conflict', async () => {
    const old = { title: 'Old', content: null };
    const firstLocal = { title: 'First local', content: textDocument('Local') };
    const laterLocal = { title: 'Later local', content: textDocument('Typed while loading') };
    const getPending = deferred<NoteDetail>();
    const coordinator = new NoteSaveCoordinator({
      initialDraft: old,
      initialNote: detail(9, 5, old),
      transport: {
        create: vi.fn(),
        update: vi.fn().mockRejectedValue(conflictError()),
        get: vi.fn().mockReturnValue(getPending.promise),
      },
      onChange: vi.fn(),
    });
    coordinator.edit(firstLocal);
    await coordinator.flush();
    const resolution = coordinator.resolveConflict('load-server');
    coordinator.edit(laterLocal);
    getPending.resolve(detail(9, 6, { title: 'Server', content: null }));
    await resolution;

    expect(coordinator.snapshot()).toMatchObject({
      draft: laterLocal,
      phase: 'conflict',
      replacementRevision: 0,
    });
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
      tags: [],
    });
    expect(coordinator.snapshot()).toMatchObject({ draft: local, phase: 'conflict' });
    coordinator.dispose();
  });

  it('serializes tag edits during create into one PATCH and preserves a revert to the created baseline', async () => {
    const first = { title: 'Tagged note', content: null, tags: [{ name: 'Planning' }] };
    const changed = { ...first, tags: [{ id: 8 }, { name: 'Urgent' }] };
    const createResponse = deferred<NoteDetail>();
    const create = vi.fn().mockReturnValue(createResponse.promise);
    const update = vi
      .fn()
      .mockImplementation(async (_id, body) => detail(88, 1, { ...first, tags: body.tags }));
    const coordinator = new NoteSaveCoordinator({
      initialDraft: first,
      initialNote: null,
      transport: { create, update, get: vi.fn() },
      onChange: vi.fn(),
    });

    const saving = coordinator.flush();
    await Promise.resolve();
    expect(create).toHaveBeenCalledWith(
      { title: 'Tagged note', content: null, tags: [{ name: 'Planning' }] },
      expect.any(String)
    );
    coordinator.edit(changed);
    coordinator.edit(first);
    createResponse.resolve({ ...detail(88, 0, first), tags: [{ id: 3, name: 'Planning' }] });
    await saving;

    expect(update).not.toHaveBeenCalled();
    expect(coordinator.snapshot()).toMatchObject({
      draft: { ...first, tags: [{ id: 3 }] },
      phase: 'saved',
    });
    coordinator.dispose();
  });

  it('creates a single follow-up PATCH when tags change while POST is in flight', async () => {
    vi.useFakeTimers();
    const original = { title: 'Tagged note', content: null, tags: [{ name: 'Planning' }] };
    const edited = { ...original, tags: [{ id: 8 }, { name: 'Urgent' }] };
    const createResponse = deferred<NoteDetail>();
    const create = vi.fn().mockReturnValue(createResponse.promise);
    const update = vi
      .fn()
      .mockResolvedValue({
        ...detail(89, 1, edited),
        tags: [
          { id: 8, name: 'Planning' },
          { id: 9, name: 'Urgent' },
        ],
      });
    const coordinator = new NoteSaveCoordinator({
      initialDraft: original,
      initialNote: null,
      transport: { create, update, get: vi.fn() },
      onChange: vi.fn(),
    });

    const saving = coordinator.flush();
    await Promise.resolve();
    coordinator.edit(edited);
    createResponse.resolve({ ...detail(89, 0, original), tags: [{ id: 3, name: 'Planning' }] });
    await saving;
    await vi.advanceTimersByTimeAsync(900);

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(89, {
      expectedVersion: 0,
      title: 'Tagged note',
      content: null,
      tags: [{ id: 8 }, { name: 'Urgent' }],
    });
    expect(coordinator.snapshot()).toMatchObject({
      draft: { ...edited, tags: [{ id: 8 }, { id: 9 }] },
      phase: 'saved',
    });
    coordinator.dispose();
  });

  it('rebuilds a definitive invalid create with a fresh key and the corrected Tags', async () => {
    const invalid = { title: 'Retry me', content: null, tags: [{ name: 'Bad\nTag' }] };
    const corrected = { ...invalid, tags: [{ name: 'Planning' }] };
    const create = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('invalid Tag'), { response: { status: 400 } }))
      .mockResolvedValueOnce({ ...detail(90, 0, corrected), tags: [{ id: 10, name: 'Planning' }] });
    const coordinator = new NoteSaveCoordinator({
      initialDraft: invalid,
      initialNote: null,
      transport: { create, update: vi.fn(), get: vi.fn() },
      onChange: vi.fn(),
    });

    await coordinator.flush();
    expect(coordinator.snapshot()).toMatchObject({ phase: 'failed', outcomeUncertain: false });
    expect(coordinator.snapshot().frozenCreateRequest).toBeUndefined();
    coordinator.edit(corrected);
    await coordinator.retry();

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]?.[0]).toEqual({
      title: 'Retry me',
      content: null,
      tags: [{ name: 'Planning' }],
    });
    expect(create.mock.calls[1]?.[1]).not.toBe(create.mock.calls[0]?.[1]);
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'saved',
      persisted: { id: 90, version: 0 },
    });
    coordinator.dispose();
  });

  it('rebuilds a definitive invalid PATCH from the corrected Tag draft and current version', async () => {
    const initial = { title: 'Existing', content: null, tags: [] as { id: number }[] };
    const corrected = { ...initial, tags: [{ id: 12 }] };
    const update = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('invalid Tag'), { response: { status: 400 } }))
      .mockResolvedValueOnce({
        ...detail(91, 3, corrected),
        tags: [{ id: 13, name: 'Planning' }],
      });
    const coordinator = new NoteSaveCoordinator({
      initialDraft: initial,
      initialNote: { ...detail(91, 2, initial), tags: [] },
      transport: { create: vi.fn(), update, get: vi.fn() },
      onChange: vi.fn(),
    });

    coordinator.edit(corrected);
    await coordinator.flush();
    expect(coordinator.snapshot()).toMatchObject({ phase: 'failed', outcomeUncertain: false });
    coordinator.edit({ ...initial, tags: [{ id: 13 }] });
    await coordinator.retry();

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(91, {
      expectedVersion: 2,
      title: 'Existing',
      content: null,
      tags: [{ id: 13 }],
    });
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'saved',
      persisted: { id: 91, version: 3 },
    });
    coordinator.dispose();
  });

  it('keeps and loads whole Tag selections when resolving a version conflict', async () => {
    const local = { title: 'Mine', content: null, tags: [{ id: 1 }] };
    const server = { title: 'Theirs', content: null, tags: [{ id: 2 }] };
    const update = vi
      .fn()
      .mockResolvedValue({ ...detail(92, 4, local), tags: [{ id: 1, name: 'Local' }] });
    const coordinator = new NoteSaveCoordinator({
      initialDraft: local,
      initialNote: { ...detail(92, 3, server), tags: [{ id: 2, name: 'Remote' }] },
      transport: {
        create: vi.fn(),
        update,
        get: vi
          .fn()
          .mockResolvedValue({ ...detail(92, 3, server), tags: [{ id: 2, name: 'Remote' }] }),
      },
      onChange: vi.fn(),
    });

    expect(coordinator.snapshot().phase).toBe('dirty');
    // A 409 leaves the entire local draft, including Tag IDs, available for Keep.
    update.mockRejectedValueOnce(conflictError());
    await coordinator.flush();
    expect(coordinator.snapshot()).toMatchObject({ draft: local, phase: 'conflict' });
    await coordinator.resolveConflict('keep-local');
    expect(update).toHaveBeenLastCalledWith(92, {
      expectedVersion: 3,
      title: 'Mine',
      content: null,
      tags: [{ id: 1 }],
    });

    update.mockClear();
    // A later conflict can replace the full draft from the server, including Tags.
    coordinator.edit({ title: 'Another local edit', content: null, tags: [{ id: 5 }] });
    update.mockRejectedValueOnce(conflictError());
    await coordinator.flush();
    await coordinator.resolveConflict('load-server');
    expect(coordinator.snapshot()).toMatchObject({
      draft: { title: 'Theirs', tags: [{ id: 2 }] },
      phase: 'saved',
    });
    coordinator.dispose();
  });
});
