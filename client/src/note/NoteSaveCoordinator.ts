import {
  hasMeaningfulNoteDraft,
  normalizeNoteDraft,
  noteDraftsEqual,
  type NoteDraft,
} from './noteDraft';
import type { NoteDetail } from './types';

export type NoteSavePhase =
  'clean' | 'dirty' | 'saving' | 'saved' | 'failed' | 'conflict' | 'paused';

export interface NoteSaveSnapshot {
  draft: NoteDraft;
  localRevision: number;
  confirmedRevision: number;
  persisted: { id: number; version: number } | null;
  phase: NoteSavePhase;
  hasUnsavedChanges: boolean;
  writeInFlight: boolean;
  outcomeUncertain: boolean;
  resolvingConflict: boolean;
  replacementRevision: number;
  frozenCreateRequest?: { body: ReturnType<typeof normalizeNoteDraft>; key: string };
  frozenUpdateRequest?: FrozenNoteUpdate;
}

export interface NoteTransport {
  create: (body: ReturnType<typeof normalizeNoteDraft>, key: string) => Promise<NoteDetail>;
  update: (
    id: number,
    body: {
      expectedVersion: number;
      title: string | null;
      content: NonNullable<ReturnType<typeof normalizeNoteDraft>['content']> | null;
    }
  ) => Promise<NoteDetail>;
  get: (id: number) => Promise<NoteDetail>;
}

export interface NoteSaveRecoveryState {
  persistedVersion: { id: number; version: number } | undefined;
  frozenCreateRequest: { body: ReturnType<typeof normalizeNoteDraft>; key: string } | undefined;
  frozenUpdateRequest: FrozenNoteUpdate | undefined;
}

interface NoteSaveCoordinatorOptions {
  initialDraft: NoteDraft;
  initialNote: NoteDetail | null;
  transport: NoteTransport;
  onChange: (snapshot: NoteSaveSnapshot) => void;
  onCreated?: (note: NoteDetail) => void;
  onUpdated?: (note: NoteDetail) => void;
  canDispatch?: () => boolean;
  debounceMs?: number;
  recovery?: {
    persistedVersion?: { id: number; version: number };
    frozenCreateRequest?: { body: ReturnType<typeof normalizeNoteDraft>; key: string };
    frozenUpdateRequest?: FrozenNoteUpdate;
  };
}

interface FrozenCreate {
  body: ReturnType<typeof normalizeNoteDraft>;
  key: string;
  revision: number;
}

export interface FrozenNoteUpdate {
  id: number;
  body: {
    expectedVersion: number;
    title: string | null;
    content: ReturnType<typeof normalizeNoteDraft>['content'];
  };
  draft: NoteDraft;
  revision: number;
}

function noteDraft(note: NoteDetail): NoteDraft {
  return { title: note.title ?? '', content: note.content };
}

function errorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('response' in error)) return null;
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('status' in response)) return null;
  return typeof response.status === 'number' ? response.status : null;
}

function initialBaseline(options: NoteSaveCoordinatorOptions): NoteDraft {
  return options.initialNote ? noteDraft(options.initialNote) : { ...options.initialDraft };
}

function initialPersisted(
  note: NoteDetail | null | undefined
): { id: number; version: number } | null {
  return note ? { id: note.id, version: note.version } : null;
}

export class NoteSaveCoordinator {
  private draft: NoteDraft;
  private localRevision = 0;
  private confirmedRevision = 0;
  private replacementRevision = 0;
  private persisted: { id: number; version: number } | null;
  private baseline: NoteDraft;
  private phase: NoteSavePhase = 'clean';
  private readonly transport: NoteTransport;
  private readonly onChange: (snapshot: NoteSaveSnapshot) => void;
  private readonly onCreated?: (note: NoteDetail) => void;
  private readonly onUpdated?: (note: NoteDetail) => void;
  private readonly canDispatch?: () => boolean;
  private readonly debounceMs: number;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceElapsed = false;
  private inFlight: Promise<void> | null = null;
  private outcomeUncertain = false;
  private resolvingConflict = false;
  private pendingCreate: FrozenCreate | null = null;
  private pendingUpdate: FrozenNoteUpdate | null = null;
  private paused = false;
  private navigationHeld = false;
  private disposed = false;
  private generation = 0;

  constructor(options: NoteSaveCoordinatorOptions) {
    this.draft = { ...options.initialDraft };
    this.baseline = initialBaseline(options);
    this.persisted = initialPersisted(options.initialNote);
    this.phase = options.initialNote ? 'saved' : 'clean';
    this.transport = options.transport;
    this.onChange = options.onChange;
    this.onCreated = options.onCreated;
    this.onUpdated = options.onUpdated;
    this.canDispatch = options.canDispatch;
    this.debounceMs = options.debounceMs ?? 900;
    this.restorePendingCreate(options);
    this.restorePendingUpdate(options);
    this.restoreVersionState(options);
    this.restoreDraftState(options.initialNote);
  }

  edit(draft: NoteDraft): void {
    if (this.disposed || noteDraftsEqual(this.draft, draft)) return;
    this.draft = { ...draft };
    this.localRevision += 1;
    this.debounceElapsed = false;

    if (this.phase === 'conflict' || this.phase === 'failed' || this.paused) {
      this.phase = this.paused ? 'paused' : this.phase;
    } else if (!this.persisted && !hasMeaningfulNoteDraft(this.draft) && !this.pendingCreate) {
      this.confirmedRevision = this.localRevision;
      this.phase = 'clean';
      this.clearTimer();
    } else {
      this.phase = this.paused ? 'paused' : 'dirty';
      if (!this.paused && !this.navigationHeld) this.scheduleSave();
    }
    this.publish();
  }

  async flush(): Promise<void> {
    if (
      this.disposed ||
      this.paused ||
      this.navigationHeld ||
      this.phase === 'conflict' ||
      this.phase === 'failed'
    )
      return;
    this.clearTimer();
    this.debounceElapsed = true;

    if (this.inFlight) {
      const active = this.inFlight;
      await active;
      if (this.shouldContinue()) await this.flush();
      return;
    }

    if (!this.hasWork()) return;
    this.phase = 'saving';
    this.publish();
    const generation = this.generation;
    const operation = Promise.resolve().then(() => this.saveOnce(generation));
    this.inFlight = operation;
    this.publish();
    await operation;
    if (this.inFlight === operation) {
      this.inFlight = null;
      this.publish();
    }
    if (this.shouldContinue()) await this.flush();
  }

  async retry(): Promise<void> {
    if (this.phase !== 'failed') return;
    this.phase = 'dirty';
    this.debounceElapsed = true;
    this.publish();
    await this.flush();
  }

  async resolveConflict(choice: 'keep-local' | 'load-server'): Promise<void> {
    if (this.resolvingConflict) return;
    this.resolvingConflict = true;
    this.publish();
    try {
      await this.resolveConflictOnce(choice);
    } finally {
      this.resolvingConflict = false;
      this.publish();
    }
  }

  private async resolveConflictOnce(choice: 'keep-local' | 'load-server'): Promise<void> {
    if (this.disposed || this.paused || this.phase !== 'conflict' || !this.persisted) return;
    if (this.inFlight) await this.inFlight;
    if (this.disposed || this.paused || this.phase !== 'conflict' || !this.persisted) return;

    const generation = this.generation;
    const confirmedRevision = this.localRevision;
    let latest: NoteDetail;
    try {
      latest = await this.transport.get(this.persisted.id);
    } catch {
      if (!this.disposed && !this.paused && generation === this.generation) this.publish();
      return;
    }
    if (this.disposed || this.paused || generation !== this.generation) return;

    if (choice === 'load-server') {
      if (this.localRevision !== confirmedRevision) {
        this.publish();
        return;
      }
      this.draft = noteDraft(latest);
      this.baseline = { ...this.draft };
      this.persisted = { id: latest.id, version: latest.version };
      this.pendingUpdate = null;
      this.pendingCreate = null;
      this.localRevision += 1;
      this.confirmedRevision = this.localRevision;
      this.replacementRevision += 1;
      this.phase = 'saved';
      this.publish();
      return;
    }

    const local = { ...this.draft };
    if (noteDraftsEqual(local, noteDraft(latest))) {
      this.draft = noteDraft(latest);
      this.baseline = { ...this.draft };
      this.persisted = { id: latest.id, version: latest.version };
      this.pendingUpdate = null;
      this.localRevision += 1;
      this.confirmedRevision = this.localRevision;
      this.phase = 'saved';
      this.publish();
      return;
    }

    const normalized = normalizeNoteDraft(local);
    this.persisted = { id: latest.id, version: latest.version };
    this.pendingUpdate = {
      id: latest.id,
      body: {
        expectedVersion: latest.version,
        title: normalized.title,
        content: normalized.content,
      },
      draft: local,
      revision: this.localRevision,
    };
    this.phase = 'dirty';
    this.debounceElapsed = true;
    this.publish();
    await this.flush();
  }

  pause(): void {
    if (this.disposed || this.paused) return;
    this.paused = true;
    this.clearTimer();
    this.phase = 'paused';
    this.publish();
  }

  holdQueuedWritesForNavigation(): void {
    if (this.disposed || this.navigationHeld) return;
    this.navigationHeld = true;
    this.clearTimer();
  }

  releaseQueuedWritesForNavigation(): void {
    if (this.disposed || !this.navigationHeld) return;
    this.navigationHeld = false;
    if (!this.paused && this.phase === 'dirty' && this.hasWork()) this.scheduleSave();
  }

  async resume(): Promise<void> {
    if (this.disposed) return;
    if (!this.paused) {
      if (this.phase === 'dirty' && this.hasWork()) this.scheduleSave();
      return;
    }
    this.paused = false;
    if (!(await this.refreshPersistedVersion())) return;
    this.phase = this.hasWork() ? 'dirty' : 'saved';
    this.publish();
    if (this.hasWork()) await this.flush();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.clearTimer();
  }

  snapshot(): NoteSaveSnapshot {
    return {
      draft: { ...this.draft },
      localRevision: this.localRevision,
      confirmedRevision: this.confirmedRevision,
      persisted: this.persisted ? { ...this.persisted } : null,
      phase: this.phase,
      replacementRevision: this.replacementRevision,
      hasUnsavedChanges:
        this.hasWork() ||
        this.localRevision > this.confirmedRevision ||
        this.phase === 'failed' ||
        this.phase === 'conflict',
      writeInFlight: this.inFlight !== null,
      outcomeUncertain: this.outcomeUncertain,
      resolvingConflict: this.resolvingConflict,
      ...(this.pendingCreate
        ? {
            frozenCreateRequest: {
              body: { ...this.pendingCreate.body },
              key: this.pendingCreate.key,
            },
          }
        : {}),
      ...(this.pendingUpdate
        ? {
            frozenUpdateRequest: {
              ...this.pendingUpdate,
              body: { ...this.pendingUpdate.body },
              draft: { ...this.pendingUpdate.draft },
            },
          }
        : {}),
    };
  }

  recoverySnapshot(): NoteSaveRecoveryState {
    return {
      persistedVersion: this.persisted ? { ...this.persisted } : undefined,
      frozenCreateRequest: this.pendingCreate
        ? { body: { ...this.pendingCreate.body }, key: this.pendingCreate.key }
        : undefined,
      frozenUpdateRequest: this.pendingUpdate
        ? {
            ...this.pendingUpdate,
            body: { ...this.pendingUpdate.body },
            draft: { ...this.pendingUpdate.draft },
          }
        : undefined,
    };
  }

  private async saveOnce(generation: number): Promise<void> {
    if (this.disposed || this.paused || generation !== this.generation) return;
    if (this.navigationHeld) {
      this.phase = this.hasWork() ? 'dirty' : 'saved';
      this.publish();
      return;
    }
    if (this.canDispatch && !this.canDispatch()) {
      this.paused = true;
      this.phase = 'paused';
      this.publish();
      return;
    }

    if (!this.persisted) {
      await this.createNote(generation);
      return;
    }

    await this.updateNote(generation);
  }

  private restorePendingCreate(options: NoteSaveCoordinatorOptions): void {
    const pendingCreate = options.recovery?.frozenCreateRequest;
    if (!options.initialNote && pendingCreate) {
      this.pendingCreate = { ...pendingCreate, revision: 0 };
    }
  }

  private restorePendingUpdate(options: NoteSaveCoordinatorOptions): void {
    const pendingUpdate = options.recovery?.frozenUpdateRequest;
    if (!options.initialNote || !pendingUpdate || pendingUpdate.id !== options.initialNote.id)
      return;
    this.pendingUpdate = {
      ...pendingUpdate,
      body: { ...pendingUpdate.body },
      draft: { ...pendingUpdate.draft },
    };
    this.outcomeUncertain = true;
    this.paused = true;
    this.phase = 'paused';
  }

  private restoreVersionState(options: NoteSaveCoordinatorOptions): void {
    const initialNote = options.initialNote;
    const recoveryVersion = options.recovery?.persistedVersion;
    if (options.recovery?.frozenUpdateRequest) return;
    if (!initialNote || !recoveryVersion || recoveryVersion.id !== initialNote.id) return;
    if (recoveryVersion.version === initialNote.version) return;
    this.phase = noteDraftsEqual(this.draft, noteDraft(initialNote)) ? 'saved' : 'conflict';
  }

  private restoreDraftState(initialNote: NoteDetail | null | undefined): void {
    if (this.phase === 'conflict') return;
    const hasChanges = initialNote
      ? !noteDraftsEqual(this.draft, this.baseline)
      : hasMeaningfulNoteDraft(this.draft);
    if (hasChanges) this.phase = 'dirty';
  }

  private async refreshPersistedVersion(): Promise<boolean> {
    const persisted = this.persisted;
    if (!persisted) return true;
    const generation = this.generation;
    try {
      const latest = await this.transport.get(persisted.id);
      if (this.disposed || this.paused || generation !== this.generation) return false;
      if (this.pendingUpdate && noteDraftsEqual(this.pendingUpdate.draft, noteDraft(latest))) {
        this.acknowledgeUpdate(this.pendingUpdate, latest);
      } else if (latest.version !== persisted.version) {
        this.phase = 'conflict';
        this.publish();
        return false;
      }
      persisted.version = latest.version;
      return true;
    } catch {
      this.phase = 'failed';
      this.publish();
      return false;
    }
  }

  private async createNote(generation: number): Promise<void> {
    if (!this.pendingCreate) {
      if (!hasMeaningfulNoteDraft(this.draft)) {
        this.confirmedRevision = this.localRevision;
        this.phase = 'clean';
        this.publish();
        return;
      }
      this.pendingCreate = {
        body: normalizeNoteDraft(this.draft),
        key: globalThis.crypto.randomUUID(),
        revision: this.localRevision,
      };
    }

    const request = this.pendingCreate;
    try {
      const created = await this.transport.create(request.body, request.key);
      if (this.disposed || this.paused || generation !== this.generation) return;
      this.outcomeUncertain = false;
      this.pendingCreate = null;
      this.persisted = { id: created.id, version: created.version };
      this.baseline = { title: request.body.title ?? '', content: request.body.content };
      this.confirmedRevision = request.revision;
      this.phase = this.hasWork() ? 'dirty' : 'saved';
      this.publish();
      this.onCreated?.(created);
    } catch {
      if (this.disposed || generation !== this.generation) return;
      this.outcomeUncertain = true;
      this.phase = 'failed';
      this.publish();
    }
  }

  private async updateNote(generation: number): Promise<void> {
    const persisted = this.persisted;
    if (!persisted) return;
    if (!this.pendingUpdate) {
      if (noteDraftsEqual(this.draft, this.baseline)) {
        this.confirmedRevision = this.localRevision;
        this.phase = 'saved';
        this.publish();
        return;
      }
      const normalized = normalizeNoteDraft(this.draft);
      this.pendingUpdate = {
        id: persisted.id,
        body: {
          expectedVersion: persisted.version,
          title: normalized.title,
          content: normalized.content,
        },
        draft: { ...this.draft },
        revision: this.localRevision,
      };
    }

    const request = this.pendingUpdate;
    try {
      const updated = await this.transport.update(request.id, request.body);
      if (this.disposed || this.paused || generation !== this.generation) return;
      this.acknowledgeUpdate(request, updated);
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.outcomeUncertain = true;
      await this.handleUpdateFailure(error, request, generation);
    }
  }

  private async handleUpdateFailure(
    error: unknown,
    request: FrozenNoteUpdate,
    generation: number
  ): Promise<void> {
    const status = errorStatus(error);
    if (status === 409) {
      this.outcomeUncertain = false;
      this.phase = 'conflict';
      this.publish();
      return;
    }
    if (status === 401) {
      this.paused = true;
      this.phase = 'paused';
      this.publish();
      return;
    }
    await this.reconcileFailedUpdate(request, generation);
  }

  private async reconcileFailedUpdate(
    request: FrozenNoteUpdate,
    generation: number
  ): Promise<void> {
    try {
      const latest = await this.transport.get(request.id);
      if (this.disposed || this.paused || generation !== this.generation) return;
      if (noteDraftsEqual(request.draft, noteDraft(latest))) {
        this.acknowledgeUpdate(request, latest);
      } else if (latest.version === request.body.expectedVersion) {
        this.outcomeUncertain = false;
        this.phase = 'failed';
        this.publish();
      } else {
        this.outcomeUncertain = false;
        this.phase = 'conflict';
        this.publish();
      }
    } catch {
      if (this.disposed || generation !== this.generation) return;
      this.phase = 'failed';
      this.publish();
    }
  }

  private acknowledgeUpdate(request: FrozenNoteUpdate, updated: NoteDetail): void {
    this.pendingUpdate = null;
    this.outcomeUncertain = false;
    this.persisted = { id: request.id, version: updated.version };
    this.baseline = { ...request.draft };
    this.confirmedRevision = request.revision;
    this.phase = this.hasWork() ? 'dirty' : 'saved';
    this.publish();
    this.onUpdated?.(updated);
  }

  private hasWork(): boolean {
    if (this.pendingCreate || this.pendingUpdate) return true;
    if (!this.persisted) return hasMeaningfulNoteDraft(this.draft);
    return !noteDraftsEqual(this.draft, this.baseline);
  }

  private shouldContinue(): boolean {
    return (
      this.debounceElapsed &&
      this.hasWork() &&
      !this.paused &&
      !this.navigationHeld &&
      this.phase !== 'failed' &&
      this.phase !== 'conflict'
    );
  }

  private scheduleSave(): void {
    if (this.disposed || this.navigationHeld || this.paused) return;
    this.clearTimer();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.debounceElapsed = true;
      void this.flush();
    }, this.debounceMs);
  }

  private clearTimer(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  private publish(): void {
    if (!this.disposed) this.onChange(this.snapshot());
  }
}
