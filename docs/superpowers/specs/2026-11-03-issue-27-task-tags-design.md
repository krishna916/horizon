# Issue #27 — Task Tags Assignment and Suggestions Design

**Status:** Owner-approved 2026-11-03. **Issue:** [#27](https://github.com/krishna916/horizon/issues/27) · **Task epic:** #2 · **Shared Tags epic:** #8.  
**Prerequisites:** #56 (Tag aggregate/persistence), #57 (public Tag contracts/suggestions), both implemented on `master`.  
**Visual baseline:** [Tasks workspace approved design](../../design/tasks-workspace/DESIGN-SPEC.md). This specification resolves its deferred tag interaction; the prototype's comma-separated input is not a production requirement.

## Intent, scope and exclusions

Provide shared Tag assignment on Task creation and detail editing, with suggestions, case-insensitive reuse, persistence, and tag metadata in Task lists. A Task may have zero or many user-owned Tags. Tags remain independent reusable entities after the last association is removed. A tag's spelling is preserved from its original persisted record.

**In scope:** `task_tag` association persistence; existing/new tag selection; atomic replacement; GET/POST/PATCH response contracts; owner-scoped batch loading; autocomplete; Task creation and per-field editing; row metadata; tests.

**Not in scope:** tag administration/rename/merge/delete, Notes tagging, Search by Tag, tag filtering (#29), Tag statuses, Task status enums, new Task lifecycle behavior, a standalone Tag-creation endpoint, or an additional dependency/framework.

## Owner-approved behavior (eight explicit decisions)

1. **Independent Inbox review:** Creating, adding, removing, or replacing tags **never** modifies `task.inbox`. Leaving Inbox requires its own explicit review action. This takes precedence for #27 over PRD-003 Inbox FR-010's optional suggestion that tagging *may* remove an item from Inbox, and agrees with SPEC-001's independent Inbox model.
2. **Chip-based selector:** Same reusable selection control in Task creation and Task editing. Show selected removable chips; typing shows owner-scoped existing-tag suggestions; user may explicitly choose **Create “name”**. No comma splitting (commas are valid tag-name content). Accessible keyboard/pointer interactions and visible loading/error/empty states.
3. **Create on Save:** A new-name chip is only a draft. No Tag row is created when selected; Tag creation and Task association occur inside the Task save transaction. Cancel leaves neither Tag nor association. A successfully persisted Tag stays reusable after unassignment.
4. **Atomic complete-set replacement:** PATCH with `tags` omitted leaves them unchanged; `tags: []` clears *associations only*; `tags: [...]` replaces the set in one transaction. Other Task fields are unaffected.
5. **Input identity:** Existing suggestions submit `{ "id": 42 }`, new tags submit `{ "name": "Architecture" }`. Every output tag contains both ID and canonical persisted display name.
6. **Alphabetical display:** Sort case-insensitively by stored name, with deterministic tie-breakers; no association ordering column or user-configured sort. Applies to rows, details and edit form.
7. **Lifecycle preservation:** Completion, reopen, archive, restore archive, soft delete and restore deleted do not alter associations or reusable Tag rows.
8. **Compact rows:** Task list shows the first **two** alphabetically ordered tags and a noninteractive **+N** overflow count. Task details and editor show **all** tags.

## HTTP contract

Extend existing Task resource endpoints; **no new Task tagging controller**.

```json
POST /api/v1/tasks
{
  "title": "Prepare database migration",
  "tags": [{ "id": 42 }, { "name": "Architecture" }]
}

PATCH /api/v1/tasks/123
{ "tags": [{ "id": 42 }, { "name": "Architecture" }] }

PATCH /api/v1/tasks/123
{ "tags": [] }
```

- `POST`: optional `tags` defaults to empty; keep title-only creation valid and workspace creation `inbox=false`.
- `PATCH`: tag field uses existing presence-aware `TaskPatch` semantics; omission leaves current associations unchanged; null is **invalid**, never synonymous with empty.
- Each selection must be an object containing **exactly one** of `id` or `name`. ID: positive integral number; name: string validated by the shared Tag module (existing #56 policy: trimmed edge whitespace, nonblank, no ISO control characters, at most 100 Unicode code points). Reject malformed arrays/elements, unexpected selection properties and empty/invalid names as 400 RFC 9457 Problem Details with `errors.tags`. Duplicate references and case-equivalent names collapse into one association by resolved Tag ID; no duplicate links.
- A non-existent or other-user tag ID yields indistinguishable **404**, with no Task or Tag changes. Existing Task ownership checks remain repository-scoped. Never accept userId from a request.
- `GET /api/v1/tasks` summary items and all Task detail responses (create/get/PATCH/lifecycle) include `tags: [{ "id": 42, "name": "Backend" }]` (always an array), sorted as above. No Tag JPA entity escapes as an HTTP DTO.
- Existing `GET /api/v1/tags/suggestions?q=<prefix>` from #57 remains the only Tag HTTP endpoint. It is authenticated, owner-scoped, literal prefix case-insensitive, max 10 alphabetical results; blank present q => empty, missing q => 400. Unassociated Tags remain suggestible.

## Persistence and module ownership

`task` owns association persistence; `tag` owns reusable Tag records and queries.

```text
TaskController / Task application
  ├── TaskRepository (owner-scoped Task root)
  ├── TaskTagAssociationRepository [task.infrastructure, scalar IDs only]
  ├── TagCommandApi.resolveByName(ownerId,name)  -> TagReference
  └── TagQueryApi.findById / findAllByIds(ownerId,ids) -> TagReference
                         │ public tag.api boundary only
                         ▼
                tag.application + tag.infrastructure (private)
```

Use a Task-owned Flyway migration `V20261103000000__create_task_tag.sql`:

- `task_tag(task_id BIGINT NOT NULL, tag_id BIGINT NOT NULL)`; composite PK `(task_id,tag_id)`, FKs to `task(id)` and `tag(id)`; index `(tag_id)` for FK/reverse lookups. No `user_id`, status, lifecycle or position column in this pure association table.
- A small **JDBC** `task.infrastructure.TaskTagAssociationRepository` stores/reads scalar IDs, with Task-ownership filtering on reads/writes; it must not query Tag names or import `tag.domain`/`tag.infrastructure`. No `@ManyToMany<Task,Tag>` or duplicate Tag aggregate in Task.
- Extend the approved `tag.api.TagQueryApi` by `List<TagReference> findAllByIds(Long userId, Collection<Long> ids)`, with owner-scoped SQL/JPA query in the Tag module. Empty IDs return empty. This is a **#27-scoped addition** to #57, specifically approved for avoiding N+1 Tag lookups.
- Task lists batch-read association IDs for all listed Task IDs in one query and Tag references in one Tag API batch call; details use the same mapping path for a single task. Never call `findById` for each tag while rendering list items. Unknown or cross-owner IDs must not leak names.
- On a tag-changing save, lock the **owned Task row** for serialization of concurrent full-set replacements; compare resolved ID sets, replace only if changed, and update the Task's `updated_at` when changed. Do not update Inbox or lifecycle timestamps. A no-op identical set avoids unnecessary link rewrites.
- All write steps (Task update/create, Tag resolution, link replacement, timestamp update, idempotency receipt) occur in one `READ_COMMITTED` transaction. `TagCommandApi.resolveByName` already has `Propagation.MANDATORY`; do not introduce `REQUIRES_NEW`, raw Tag table access from Tasks or extra transaction boundaries. Roll back new Tag rows if the enclosing Task save fails.

### Existing Task creation idempotency

`IdempotentTaskCreationService` uses `TaskCreationFingerprint` and request-key receipts. Include the submitted tag selection set in the fingerprint. Canonicalize order so selection order is immaterial, while keeping IDs and names distinguishable and preserving raw name identity conservatively (a different name spelling may conflict safely rather than falsely replay another request). The same key+same request replays the original Task and its persisted tags, not a second Task/Tag. The same key+different tags returns the existing 409 conflict. Retried ambiguous network failures continue using the same immutable payload and key.

## Frontend integration

- `client/src/tag/api.ts` owns the client-facing Tag suggestions request/response types (or an equivalently small existing feature-module file), using the shared Axios client. Key TanStack Query results by current owner ID **and** normalized query; avoid stale/out-of-owner suggestion reuse. Do not expose a client Tag-create request.
- A reusable `TaskTagSelector` manages `{id}` existing choices and `{name}` drafts, removable chips, explicit create choice, duplicate prevention and suggestions; it delegates persistence to the containing form/editor. Support keyboard focus, arrow navigation, Enter, Escape, mouse selection, accessible option labels and in-flight/error feedback. Typing does not mutate the Task.
- Task creation integrates the selector's draft with its existing dirty-state/abandonment guard, submission snapshot, retry-with-same-idempotency-key, validation messages and disabled-while-submitting states. Cancel discards drafts.
- Task details keep double-click (plus existing keyboard equivalent) to edit the Tags field, **Save/Cancel** per-field, and register with the existing `TaskDraftNavigationGuard`. Coordinate with existing scalar/description/checklist sessions; avoid simultaneous competing editors or bypassing the guard. Full-page and side panel use the same detail component.
- `useUpdateTask` updates both cached detail `tags` and list-summary `tags` for a successful patch. Creation and lifecycle cache projections must retain tags; keep owner-scoped query keys. Render tag metadata inside the existing Task row open button without nested interactive controls. The `+N` count should be accessible (include hidden names or an accessible description); all tags visible in details.

## Approaches considered and decision rationale

| Concern | Chosen | Not chosen |
|---|---|---|
| Input | Chips + suggestions + explicit Create | Comma-delimited prototype, ambiguous for legal comma names |
| Save | Create tags only on Task Save | Immediate independent Tag creation on chip selection |
| Update | One atomic full-set PATCH | Individual add/remove HTTP calls |
| Identity | Existing ID / new name | Name-only submissions that discard suggestion IDs |
| Ordering | Alphabetical, not stored | User-controlled association order |
| Lifecycle | Preserve associations | Clear on archive or soft delete |
| Rows | First two plus `+N` | Unbounded row wrapping |
| Persistence | Task-owned scalar JDBC association + public Tag API | Cross-module ORM relation, shared generic polymorphic table, or direct Tag internals |
| Tag lookup | One owner-scoped batch public API query | One lookup per Task/tag (N+1) |

JDBC instead of an extra JPA join entity is an implementation choice for this simple scalar association; the public module contract remains unchanged aside from the approved batch query.

## Source reconciliation and architectural constraints

- [Constitution](../../../HORIZON_CONSTITUTION.md) where available, [architecture context](../../ai/HORIZON_ARCHITECTURE_CONTEXT.md), [product context](../../ai/HORIZON_PRODUCT_CONTEXT.md) and [documentation map](../../ai/INDEX.md): modular monolith; facts-over-states; owner-scoped authorization; public module APIs; thin resource controllers, RFC 9457 errors.
- **SPEC-002 Tags v1.0**: reusable user-owned Tags, create on assignment, case-insensitive reuse, independent persistence, no administration workspace.
- **SPEC-001 Shared Concepts**: Inbox independent of Tags and lifecycle; leaving Inbox is one-way explicit review.
- **PRD-004 Tasks**: optional multiple tags in creation/editing/list/details, Active/Completed/Archived derived from Task facts. Its status/tag filters are outside this issue and gated by #29.
- **PRD-003 Inbox FR-010**: “may remove” is explicitly resolved **NO** for #27 by the owner on 2026-11-02/03; recommend reconciling the PRD in the authoritative knowledge repository separately, not altering behavior here.
- [#56 persistence design](./2026-10-31-issue-56-tag-persistence-design.md), [#57 API design](./2026-11-01-issue-57-tag-api-design.md), [approved Tasks design](../../design/tasks-workspace/DESIGN-SPEC.md) and current `master` implementation are the concrete code baseline. The older static Task mockup's comma parsing is not a specification.
- [Root agent instructions](../../../Agents.md), [server guide](../../../server/AGENTS.md), [client guide](../../../client/AGENTS.md) and ENG-001/ENG-002 govern build and testing. Actual stack at planning time: **Java 25, Spring Boot 4.0.6, Maven, PostgreSQL 17; React 19, TypeScript, TanStack Query/Router, Vitest**.

## Acceptance and verification

Prove in backend/integration and UI tests: create and reload with multiple tags; `Horizon` then `horizon` same Tag/one association; an unassigned Tag stays suggestible; canceled creation/edit does not create a Tag; invalid/cross-user IDs are 404 with rollback; 400 on malformed input; PATCH omitted/empty/nonempty semantics; owner A never sees B's tags or suggestions; association updates leave Inbox/lifecycle facts unchanged but advance `updated_at` if changed; archive/soft-delete/restore preserve links; creator idempotency replay/conflict; batch list fetch without Tag N+1; alphabetical rows, two-chip overflow, full details, keyboard suggestions, dirty navigation guards, delayed network/error retry and query-cache consistency. No non-tagging regressions.
