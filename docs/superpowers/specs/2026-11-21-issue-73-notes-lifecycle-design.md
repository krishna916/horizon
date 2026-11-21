# Horizon #73 — Notes Lifecycle Design

**Status:** Approved product direction on 2026-11-21; implementation plan subject to final owner review. **Issue:** [#73](https://github.com/krishna916/horizon/issues/73). **Design gate:** [#68](https://github.com/krishna916/horizon/issues/68) and [Notes DESIGN-SPEC](../../design/notes-workspace/DESIGN-SPEC.md). **Implementation plan:** [2026-11-21-issue-73-notes-lifecycle.md](../plans/2026-11-21-issue-73-notes-lifecycle.md). **No production code changes authorized by this document.**

## Purpose and boundaries

Make Notes recoverably archivable and deletable, preserve their content and independent lifecycle facts, and keep Cards/List/full-page editor synchronized. This is **Note-owned lifecycle functionality**; it must not add a persisted status enum, a global Trash UI, physical file cleanup, Search, file management, or a separate Notes side panel.

Current `master` already has: `Note.archivedAt`/`deletedAt`, owner-scoped repository queries, optimistic `version`, Active/Archived page/count queries, Card/List presentation, a full-page editor, and a versioned autosave coordinator. Reuse them. Current backend routes have only GET/POST/PATCH, so lifecycle mutations are new.

Read the local `Agents.md`, `client/AGENTS.md`, `server/AGENTS.md`, and `docs/ai/INDEX.md`. Use the repository's current code as source of truth when older docs are stale. Product documents remain in the knowledge repository: PRD-005 Notes, SPEC-001 Shared Concepts, PRD-008 Trash, PRD-009 Navigation and the Horizon Constitution.

### Precedence and reconciliation

- Approved Notes-specific #68 workflow supersedes older PRD-005, PRD-000, and Constitution statements about required title, Side Panel, and collapsed Archived section. **Do not edit authoritative PRDs/Constitution or unrelated Tasks workflows.**
- #69 accepted independent facts and versioned PATCH; #70 accepted Cards/List, counts and direct full-page navigation; #71 accepted safe autosave; #72 accepted Tag persistence while preserving Inbox/archive facts.
- The Tag-filter UX is a separate [#89](https://github.com/krishna916/horizon/issues/89) story, not part of #73.
- Future file associations/access are owned by #75–#80; the lifecycle must never trigger file deletion on archive or soft delete.

## Owner-approved decisions (2026-11-21)

| ID | Approved | Concrete UX outcome |
| --- | --- | --- |
| A1 | Card/List quick actions **and** editor actions | Each Note card/list row has a discreet independently focusable menu; the editor has Archive/Restore and Move to Trash actions. The full-page editor is still the only editing surface. |
| A2 | Version-aware lifecycle commands | Every Note lifecycle write compares an explicit expected version with the authoritative Note version. Conflict is `409`; never silently overwrite edits from another tab. |
| A3 | Flush pending saves before lifecycle mutations | Editor-initiated lifecycle actions await a fully confirmed save, stop if failed/conflicted/paused/uncertain, and do not discard drafts. No duplicate competing autosave system. |
| A4 | Persistent Undo with confirmation for Trash | Archive and Move-to-Trash success messages have actionable Undo until dismissed or the Notes route is left; Trash requires explicit confirmation. Archive does not require confirmation. |

## Product invariants

1. `active` ⇔ `archived_at IS NULL AND deleted_at IS NULL`; `archived` ⇔ `archived_at IS NOT NULL AND deleted_at IS NULL`; deleted ⇔ `deleted_at IS NOT NULL`. Do not create a `status` column or enum. Both Active/Archived counts exclude deleted; Inbox remains independent.
2. Archive sets `archived_at` only if absent. Restore archive clears it only. Soft delete sets `deleted_at` without touching `archived_at`. Restore from Trash clears only `deleted_at`. `inbox`, title, content, tags, timestamps unrelated to the requested mutation, and future associated files are preserved; `updated_at` and JPA version advance on an effective mutation.
3. Already-in-target-state operations with a matching current version are no-ops (do not advance `updated_at` or version). A stale expected version is `409`. An *exact duplicate* of a confirmed, one-version-increment delete may be recognized idempotently solely to recover a timed-out delete response, without making other stale writes succeed.
4. Archived Notes remain readable, editable, and browsable through Archived collection; normal Note GET/PATCH and Active/Archived list must never expose deleted Notes. User-inaccessible/missing notes return the same `404`, including lifecycle endpoints.
5. Query counts, sort/page and selection remain owned by the existing Note collection API. Do not introduce new global state, a separate UI archive route, or a new database migration for existing lifecycle columns.

## User journeys

### Browse quick actions

- Card and List use one Note collection and preserve approved row-major layout, title fallback, Tags, sort, counts, keyboard/DOM order. Place the action menu *beside*, never nested inside, the Note-opening link; activating it must not navigate.
- Menu shows Archive for active, Restore to active for archived, and Move to Trash for either; Escape closes and restores focus. Keyboard and touch interactions work. No action control renders for inaccessible/deleted records.
- Archive immediately removes the note from Active after server confirmation, and it appears in Archived on refresh/invalidation; reverse for Restore. No optimistic false-success. Counts reconcile from backend.
- Delete opens an accessible confirmation. Cancel does nothing. Confirmed success removes from regular collection, returns editor to its originating browsing context (if invoked from editor), and creates persistent Undo.
- Undo of Archive restores archived Note to Active. Undo of deletion restores the original pre-trash archive fact, including when the source was Archived. Restoring from the archived collection itself needs no additional Undo; re-archive remains available.

### Full-page editor

- Actions in the existing sticky action row; archived banner offers Restore as in #68 mockup. The editor remains mounted on Archive/Restore, with its cursor and document preserved; no side panel.
- New untouched `/notes/new` has no lifecycle actions. After first meaningful create and canonical ID replacement, lifecycle becomes available.
- At action start, prevent new editor changes while saving/performing the lifecycle operation (and block repeat actions). Flush current draft through `NoteSaveCoordinator`, including any queued Tag edits. Only dispatch lifecycle command if save is confirmed and a current Note ID/version is known.
- A failed save, optimistic conflict, session transition or uncertain write stops the lifecycle command. Keep local draft plus existing Retry/Keep my version/Load latest version affordances. Re-enable editing when safe.
- Successful Archive/Restore must update the coordinator's persisted version and metadata *without remounting/resetting the editor* or manufacturing a content edit. A successful Delete disposes/stops future draft writes, invalidates Note detail and navigates to origin only after confirmed success.
- Browser Back, reload warning, origin view/filter/sort/scroll, and owner-session boundaries remain governed by existing Notes navigation and guard. Do not bypass these via programmatic navigation.

### Recovery notices

- Notes-route-local, owner-scoped notifications remain until dismissed or route/owner is left (not a six-second toast). No Note data persisted in localStorage. Notices for different Notes coexist; superseded notices for one Note do not offer stale Undo.
- The Undo operation is a **real authenticated API call**, not merely a cache reversal. After Undo, invalidate/reconcile both collections and the detail cache. A failed Undo keeps the notice with Retry.
- Network timeout/unknown deletion outcome is **not confirmed success**. Retry with the same expected version, or reconcile through a server-confirmed lifecycle response. Never display successful Undo with a guessed post-delete version. Deletion success includes the server's new version for safe restore.
- 409 from another tab is visible, keeps the editor/draft untouched, and requires human refresh/review; no automatic retry with a newly fetched version.

## Proposed engineering HTTP contract for owner review

The decision that commands are version-aware is approved; the precise wire transport and response shape below are **implementation-level proposals fixed for Luna only after owner review of the plan**, rather than previously approved product facts.

| Method | Path | Version input | Success |
| --- | --- | --- | --- |
| POST | `/api/v1/notes/{id}/archive` | `X-Expected-Version: <nonnegative-integer>` | `200 NoteDetailResponse` |
| POST | `/api/v1/notes/{id}/restore` | same | `200 NoteDetailResponse` |
| DELETE | `/api/v1/notes/{id}` | same | `200 NoteDeletionReceipt {id,version}` |
| POST | `/api/v1/notes/{id}/restore-deleted` | same | `200 NoteDetailResponse` |

One header is shared by all verbs (avoids a DELETE request body); it follows #69's version semantics (`409` stale), while using Tasks' existing endpoint names. `200` for DELETE rather than Tasks' `204` is deliberate: the confirmed post-delete version is needed for version-safe Undo. `400` missing/malformed version, `401` unauthenticated, `404` foreign/missing/ordinary inaccessible/deleted outside recovery, `409` stale. Expose `NoteRecoveryApi` in `note.api` to future global Trash; no cross-module access to Note internal packages. Keep responses RFC 9457 compliant.

The only exception to strict stale rejection is a *duplicate delete acknowledgement*: if the owned Note is already deleted and its server version equals submitted `expectedVersion + 1` (the only subsequent state change was that deletion), return the same deletion receipt without changing anything; reject older/otherwise stale versions. This permits safe retry after a lost response. Verify the one-version guarantee in actual JPA tests; if it cannot be proved, halt and escalate rather than guessing.

## Acceptance and non-goals

Must cover owned/foreign security, concurrent PATCH vs archive/delete, repeated actions, blank/invalid expectedVersion, timestamps/no-op semantics, Active/Archived counts, archived editing, Tag/Inbox preservation, archive→delete→restore, Card/List/editor consistency, save/race/conflict/retry/Undo, page/back navigation, accessibility and account isolation.

**Explicitly deferred:** global Trash listing/permanent delete (Epic #9), file physical cleanup (#77), upload/attach/image and private blob access verification (#78/#79), Tag filters (#89), global Search (#74), bulk lifecycle operations, automatic archive, new architecture frameworks, cross-device notification persistence, authoritative PRD amendments. Until File integration lands, test `#73`'s metadata/association preservation and add a clearly marked future integration checklist; do not claim live-file preservation tests passed.
