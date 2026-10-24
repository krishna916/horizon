# Issue #23 — Task Archive, Restore and Soft Delete: design specification

**Date:** 2026-10-24
**Status:** Owner decisions confirmed in planning conversation; consolidated document for final owner review before Luna implements
**Story:** https://github.com/krishna916/horizon/issues/23
**Intended implementer:** Luna
**Approved visual baseline:** `docs/design/tasks-workspace/DESIGN-SPEC.md` (2026-10-10)
**References:** PRD-004 Tasks, SPEC-001 Shared Concepts, PRD-003 Inbox, Horizon Constitution, #21 completion design, #22 checklist behavior, #25 visibility, #9 global Trash

## 1. Purpose and story boundary

Deliver owner-safe **archive, restore archive, soft-delete, and Undo** for Task objects, using row three-dot actions and side-panel / full-page header icons. Keep the Tasks workspace calm and the persisted lifecycle fact-based.

Do **not** implement a Task status enum, state machine, separate Task Trash, global Trash UI, permanent deletion, archived-section toggle, completed-history toggle, new filter/sort, or generic notification infrastructure. Archived visibility and completed history belong to #25; global Trash listing/recovery UI belongs to #9. The existing Task schema already stores `completed_at`, `archived_at`, and `deleted_at`; no migration is required for these operations.

## 2. Approaches and accepted decisions

**Scope:** The owner selected narrow #23 implementation (Approach A), rather than bringing forward the Archived section from #25.

**Deletion:** The owner selected Delete confirmation and immediate Undo (rather than hiding Delete UI until global Trash exists).

**Archive:** The owner selected immediate Archive **without an additional confirmation**, but existing unsaved-edit protection always applies.

**Undo:** The owner selected persistent Undo for **both** Archive and Delete, not an expiring toast. Notification is available until explicit dismiss or leaving the relevant Tasks experience (list/panel/page); navigation/refresh can end the opportunity. No timer. Failed Undo preserves the notification and shows Retry.

**Detail behavior:** After Archive, leave the side panel/full-page detail open and switch the action to Restore. After Delete, return to the Tasks list with Undo available.

**Restore behavior:** The owner explicitly selected preserving `completed_at` for both archive restore and deleted-task recovery, overriding the older ambiguous “Restore → Active” prose in PRD-004.

**Unsaved edits:** The owner selected Save changes / Discard changes / Keep editing before Archive or Delete if the affected task has an unsaved edit. Save failure blocks lifecycle action; discard is explicit. Delete still requires its own confirmation; Keep editing cancels the action.

## 3. Lifecycle contract

No `status` column or enum. Classification precedence for ordinary views:

```
deleted_at != null => Trash only (no ordinary Task list or detail access)
archived_at != null => Archived only (the section UI is #25)
completed_at != null => Completed (today/history visibility decided by #25)
otherwise => Active
```

| Command | Applicable item | Persisted effect | Preserved data |
| --- | --- | --- | --- |
| Archive | Owned, non-deleted incomplete/completed task | Set `archived_at` to actual UTC instant | `completed_at`, `inbox`, checklist, task fields |
| Restore archive | Owned, non-deleted archived task | Clear `archived_at` | `completed_at`, checklist, other facts |
| Soft delete | Owned task | Set `deleted_at` to UTC instant | Existing `archived_at`, `completed_at`, `inbox`, checklist |
| Undo delete / future Trash restore | Owned deleted task | Clear `deleted_at` | Pre-delete `archived_at` and `completed_at`, checklist, fields |

Restoring an archived **unfinished** task yields Active. Restoring an archived **completed** task yields Completed or remains hidden when its completion is historical and #25 history visibility is off. Deleting an archived task and undoing deletion returns it to Archived. Deleting a completed task and undoing deletion returns it to Completed/history, not Active.

Tasks archived while `inbox=true` retain the inbox flag; the Inbox queue must exclude archived items from visibility/counts according to PRD-003. Do not treat archiving as automatic Inbox review. Editing an archived task remains supported. Ordinary deleted task GET/list/edit/complete/reopen/checklist calls remain inaccessible (404); the dedicated restore-deleted command is the owner-scoped exception.

**Idempotence proposal for resilient network retries:** Repeat archive/restore/delete/restore-deleted by the same owner should not rewrite an already-set timestamp or other facts; the command result reflects the persisted state. Owner-inaccessible and missing IDs always produce 404. This is an engineering proposal for owner review, not a separate workflow state machine.

## 4. UX behavior

### Row actions

A trailing three-dot button opens a keyboard-accessible menu; it must not also select/open the task. Show **Archive** for non-archived task, **Restore** for archived task if encountered in another context, and **Delete** for either. Row completion remains independent. Use the approved row density, existing Lucide icons, shadcn/Radix and semantic theme tokens; do not copy prototype JavaScript.

### Detail headers

Side panel and dedicated page both show visible, accessible **Archive / Restore** and **Delete** icon actions, preserving task key, full-page and close/back controls. Header actions operate independently of title/checklist editing and completion. Successful Archive updates header to Restore and preserves the open detail. The selected task may legitimately no longer be present in the ordinary Tasks list while its panel is open; the owner-scoped non-deleted detail endpoint still serves it.

### Unsaved edits and confirmation ordering

- For Archive or Delete on a task with dirty/pending field or checklist editing, first use the existing Task draft guard: **Save and continue / Discard and continue / Keep editing**. Never auto-save on blur or silently discard.
- Save must succeed before proceeding; Discard explicitly discards that draft. No lifecycle call if Save fails or Keep editing selected.
- **Archive:** once clear of drafts, submit without an extra confirmation.
- **Delete:** once clear of drafts, show a separate confirmation explaining the task is moved to Trash and can be recovered. Cancel leaves the task untouched.
- Avoid duplicate dialogs/races, and make the guard work for both panel and full page. An unrelated row action must not silently destroy a draft in another open task.

### Persistent notification and recovery

Successful Archive or Delete emits a task-specific, accessible notification with an **Undo** action. Use concise neutral messages (“Task archived”, “Task moved to Trash”); exact wording may be adjusted during owner review without changing the contract. The notice does not auto-dismiss or expire. An explicitly dismissed notice is not persisted after reentry. Do not promise in-product Trash retrieval until Epic #9 ships.

- **Undo Archive:** invoke archive-restore; on success update list/detail queries, clear notice, and show appropriate derived classification.
- **Undo Delete:** invoke owner-scoped deleted-task recovery; on success restore prior archive/completion facts and queries, clear notice.
- On Undo failure, leave notification on screen with explicit error and **Retry**; do not claim recovery succeeded.
- On Archive/Delete failure, leave the task in its confirmed state with persistent local retryable feedback, not a false success notification.
- If several tasks are archived/deleted in the same Tasks session, each undoable action must remain recoverable; do not silently replace the only notification and strand earlier tasks.

Leaving Tasks or refresh drops the ephemeral Undo UI, not server records. Global Trash will be the durable way to find previously deleted items after #9. A row archived before #25 has no list-based recovery after dismiss/navigation, which is intentionally accepted by this scope decision; direct ID detail routes remain usable for owned non-deleted archived tasks.

## 5. Proposed backend/API contract (to be verified against existing conventions)

Reuse the existing `Task` aggregate, `TaskCommandService`, `TaskController`, `TaskResponseMapper`, `CurrentUserProvider`, and owner-scoped repository methods; do not create a controller per command.

- `POST /api/v1/tasks/{id}/archive` — Archive, 200 TaskDetailResponse.
- `POST /api/v1/tasks/{id}/restore` — Restore archive, 200 TaskDetailResponse.
- `DELETE /api/v1/tasks/{id}` — Soft delete, 204 No Content; repeat delete is safe for same owner. **Never physical delete in Task workflow.**
- `POST /api/v1/tasks/{id}/restore-deleted` — Owner-scoped Undo/Trash recovery, 200 TaskDetailResponse, without making ordinary deleted GET accessible.

404 for missing/other-owner and archived restore request on deleted task; 401 for unauthenticated. Use RFC 9457 errors already present, normal session + CSRF conventions, and actual server UTC timestamps. Do not expose deleted resources through generic queries to achieve Undo.

For Epic #9, expose the *minimum* Task-owned recovery contract through `task.api` (a narrow application-facing façade returning a safe immutable recovery result, not entities, repository access, or web DTOs). It may be extended with listing/permanent deletion when that epic is designed. This issue does not implement Trash list queries or a second Trash workspace.

**Potential interaction:** completion/coordinator requests and lifecycle mutations might race on the same task. Ensure mutation ordering/cache updates cannot resurrect a deleted row or undo newer lifecycle facts. Any command requiring resolution of a prior in-flight action must retain the user's intent and show pending state, not silently discard it.

## 6. Client integration and query behavior

Reuse `client/src/task/` and owner-scoped Query keys `['tasks', userId]` and `['tasks', userId, 'detail', taskId]`. Host ephemeral lifecycle notices at the Tasks route layout so the Undo survives Delete's page→list navigation and panel closure, but clears upon leaving Tasks or account change; no global store.

On confirmed Archive/Restore, patch/invalidate affected cached fields and reclassify by persisted timestamps; don't clobber a pending completion, dirty field draft, or checklist edit. On confirmed Delete, remove task from ordinary list caches and close/delete route selection using replace navigation where appropriate. Ordinary direct deleted task GET remains a 404.

Reuse the existing `TaskDraftNavigationGuard` and Radix interaction primitives, extending the guard for a **requested action** rather than weakening route blockers. No time-limited toast or app-wide notification framework.

## 7. Verification and acceptance

1. PostgreSQL Testcontainers: archive incomplete/complete, restored completion preservation, archive/delete precedence, delete undo restores pre-delete archived/completed/checklist facts, repeated commands, access control and no accidental hard delete.
2. API integration: standard list/GET exclude deleted; archived GET still available; completion/reopen/edit blocked on deleted; no other-user mutation or accidental existence leak; authentication and RFC 9457 mapping.
3. Vitest/RTL: independent row menu/header icons; guard save/discard/keep; archive keeps detail; delete confirmation and list return; persistent multi-item Undo, Undo failure Retry; no stale query resurrection; user change clears state.
4. Playwright: list row archive→Undo, panel Archive→Restore while detail stays open, dedicated page Delete→confirm→list→Undo, dirty edit gate, keyboard interactions, API errors.
5. Existing tests for completion/list/detail/checklist and format/type/lint/static checks must still pass.

## 8. PRD reconciliation

PRD-004 currently describes “Archived → Restore → Active” and its archived restore edge case without distinguishing completion. Update its FR-009/State Transitions/Edge Case 5 wording to:

> Restoring a task clears `archived_at` only. If `completed_at` is null, the task is Active; otherwise it remains Completed and follows completed-history visibility rules.

This correction is specifically approved by the owner and was applied to the authoritative product source at `../horizon-product-knowledge/10-Product/V1/PRD-004 Tasks.md` (version 1.2, 2026-10-24). PRD-008 Trash independently requires restore to preserve the exact prior lifecycle state. The product knowledge vault is outside this code repository, so its update is recorded here and summarized in the PR description.

Other shared rules remain intact: `SPEC-001` says archive is independent of Inbox/review and Trash restoration preserves lifecycle context. No new task status field is justified.

## 9. Decision boundaries for Luna

**Owner-approved:** scope separation (#25, #9), Delete confirmation + persistent Undo, Archive without confirmation + persistent Undo, save/discard/keep guard, details stay open after Archive, list return after Delete, preservation of completion/history facts.

**Engineering proposals requiring plan review (not claimed as prior approvals):** endpoint spellings, repeated-command idempotence, precise neutral notification copy, storage/coordinator structure. Apply established Horizon conventions unless the owner identifies a product-impacting difference.

Do not invent a more elaborate Trash workspace, a permanent-delete endpoint, notification expiration, or a status enum. Stop and request approval only if a newly discovered product-level conflict changes the user-visible behavior above.
