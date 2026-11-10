# Horizon #72 — Shared Tags in Notes: Approved Design

**Status:** Approved by product owner on 2026-11-11; design only, not implementation authorization to merge.
**Issue:** [#72](https://github.com/krishna916/horizon/issues/72) · **Approved UX baseline:** [#68](https://github.com/krishna916/horizon/issues/68), [Notes DESIGN-SPEC](../../design/notes-workspace/DESIGN-SPEC.md).
**Dependencies:** #56/#57 shared Tags, #27 Task integration, #69 Note core API, #70 Notes browsing, #71 Notes editor/autosave, #43 session safety.
**Follow-up:** [#89 — temporary Notes Tag filtering (PRD-005 FR-013)](https://github.com/krishna916/horizon/issues/89). Do not close Epic #8 solely because #72 finishes.

## 1. Why and scope

Deliver one owner-scoped Tag vocabulary across Tasks and Notes with Note-owned associations. A Note can stage or assign Tags, reuse/create Tags on persisted assignment, autosave Tag changes in the existing Note lifecycle, and display canonical Tags as approved in #68. No unpersisted blank Note or shared Tag may be created by Tag selection alone.

**Non-goals:** no standalone Tag management, tag renaming/deletion/merge, hierarchy, permanent views, temporary Note Tag filters (tracked in #89), global Search-by-Tag, media upload (#78/#79), Note lifecycle commands (#73), or edits to unrelated Task product behavior. No new Note status field or new save subsystem.

**Precedence:** for Notes, approved #68 and issues #69–#72 override older PRD-005/PRD-000/Constitution required-title, panel-first and archive presentation wording. Do not silently amend authoritative product docs; a separately approved documentation reconciliation is required. PRD-003 permits Tag changes to imply Inbox review, but SPEC-001 and this explicit decision rule out such effects.

## 2. Approved decisions

| ID | Accepted decision |
| --- | --- |
| D1 | Extend existing Note POST and PATCH with `tags`; no separate Note Tag endpoint. |
| D2 | Tag changes never alter `inbox`, review state, archive/deletion facts, or Task state. |
| D3 | Tags follow #71 whole-draft conflict policy: confirmed **Keep my version** overwrites title/body/full Tag set against freshly fetched version, **Load latest version** discards all unsaved local changes. No automatic merge. |
| D4 | Extract generic Tag selector and Tag types into frontend `tag/`; preserve Task-specific explicit Save/Cancel and Task regressions. |
| D5 | POST idempotency fingerprint uses *normalized submitted Tag representations*: sorted/deduped; normalize name case and edge whitespace; `{id:42}` and `{name:"Work"}` remain different request forms even when referring to same Tag. |
| D6 | PATCH `tags` omission preserves, `[]` clears, `null` rejects 400, nonempty list replaces complete set. Same effective association set is version/timestamp no-op; changed set increments Note version and updatedAt; stale expectedVersion always 409. |
| D7 | Tag-only unpersisted `/notes/new`: only local staging; read-only suggestions allowed; no Note POST, Tag write/resolve, association or Tag row. In-app navigation requires **Stay / Discard Tags and Leave**. |
| D8 | Missing/foreign Tag IDs on Note POST/PATCH return identical generic `400` with `tags` field error; foreign or missing Note itself remains owner-safe `404`. All writes atomic. Do not change Task 404 semantics. |
| D9 | #72 owns assignment, creation/reuse, suggestion and approved Tag display only. Filtering FR-013 is future V1 work in #89; Epic #8 stays open for broader review. |
| D10 | Deterministic case-insensitive alphabetical Tag ordering in Note detail/list API, editor, Cards and List. Card shows first two chips + `+N` overflow. Preserve Task UI behavior. |
| D11 | Tag editor stays enabled during first POST; freeze initial payload/key and serialize later local Tag edits through versioned PATCH after creation acknowledgement. Preserve frozen request on uncertain retry and eligible same-owner recovery. |
| D12 | Definitive `400` Tag validation failure retains full draft and actionable Tag error, pauses autosave; user corrects and presses Retry. Corrected POST must use a new frozen body/key; corrected PATCH respects expectedVersion. Uncertain network failure reuses original frozen body/key. |
| D13 | Tag-only in-app navigation uses custom Stay/Discard confirmation. Refresh/tab close gets browser-native beforeunload warning where supported; not guaranteed. No durable storage or persistence on leave. |

**Approved clarifications (2026-11-11):** POST omitted `tags` and `tags: []` mean the same empty Tag set and share fingerprint; POST `tags: null` returns 400. In Notes, selector action for a new name says **Add tag “name”** (because it may stage only); Tasks retain **Create tag “name”**. Unexpected session expiry with *tag-only draft* preserves staged selections in application memory only for fresh verified same-user recovery; explicit logout, different account, deliberate discard, refresh/tab close permanently discard that local state.

## 3. Chosen design and rejected alternatives

- **Persistence:** Note-owned `note_tag(note_id, tag_id)` join table (composite key, Note/Tag FKs, Tag lookup index) patterned on `task_tag`. No polymorphic association or Tag-owned joins. Note application talks to `tag.api` only (`TagQueryApi`, `TagCommandApi`, `TagReference`), never another module's internals.
- **API:** extend Note POST/PATCH and existing versioned save, not separate Tag mutation routes or incremental add/remove commands. POST idempotency is by normalized *request representation*, not resolving IDs for fingerprinting.
- **UI:** shared keyboard-accessible Tag selector/type and suggestions in `client/src/tag/`, with feature-owned Task explicit save and Note autosave integration. Never import Task internals from Note.
- **Conflicts:** #71 whole-draft Keep/Load, not field-aware auto-merge.
- **Scope:** Tag assignment/display now, filtering later; no new infrastructure or Tag management surface.

## 4. Domain, HTTP and transaction contract

**Input:** Each Tag selection is exactly one of `{id: positiveLong}` or `{name: string}`. Names obey existing shared Tag normalization (including Unicode edge-space rules, 100-codepoint maximum and case-insensitive owner uniqueness); do not introduce Note-specific Tag normalization. Wrong shape, blank/invalid names, null collection and missing/foreign ID are `400` RFC 9457 Problem Details with generic `tags` error. Invalid Note ownership/missing/deleted Note remains `404`. No client ownerId is trusted.

**POST /api/v1/notes:** Existing canonical UUID Idempotency-Key remains required. Title/body meaningful creation rules remain exactly as #69: optional title, body-only and title-only allowed, tags-only invalid and never persisted. Optional `tags` array is resolved **within the same transaction** as Note creation, Note–Tag joins, idempotency claim and receipt. Same key + same normalized request returns existing Note and canonical persisted Tags **without replaying mutations**; same key + different normalized request returns 409. Fingerprint sorts/dedupes normalized Tag references; ID/name forms remain distinct. Omitted or [] means empty, null invalid. An invalid or failed POST leaves no Note, new Tag, association or receipt. In the frontend, new Tag selection alone never submits POST; later #78/#79 meaningful file/image creation must pass already-staged Tags when those stories implement their first-create flows.

**PATCH /api/v1/notes/{id}:** `expectedVersion` remains required; `title`/`content` keep #69's missing/null behavior. `tags` omitted preserves current association set; [] removes all; valid array fully replaces set. Deduplicate equivalent resolved identities. On any effective title/body/Tag change, advance Note version and updatedAt once; on effective no-op advance neither. Join-only Tag changes **must explicitly participate in Note optimistic locking**; JPA @Version does not automatically update for independent JDBC join writes. Maintain atomicity, including on concurrency and Tag resolution errors. Never modify inbox, archivedAt, deletedAt or Tag identity on unlink; unused Tags persist.

**GET /api/v1/notes/{id}, POST/PATCH responses, and paginated GET /api/v1/notes:** return `tags: [{id, name}]` ordered by case-insensitive name, then deterministic display-name/ID tie-break. Preserve existing Note paging, counts, sorts, JSONB preview and owner boundaries. Batch hydrate Tag IDs/names for a bounded Notes page (not one Tag query per Note). Query owning Note associations through Note repository; resolve Tag identities only through shared TagQueryApi.

**Failure distinctions:** confirmed Tag 400 is definitive and permits corrected fresh POST key. 409 stale Note version uses explicit conflict actions. Lost response/timeout has uncertain outcome: retry *same frozen POST and key*, or reconcile existing versioned PATCH before any newer write. Never send a changed POST payload with an old key.

## 5. Frontend, navigation and recovery

- **Placement:** full-page Note editor metadata between title and rich-text toolbar/body, per #68. Cards maintain max 440px height and show first two alphabetical Tags + overflow. Compact List includes Tag column, progressively hidden on narrow view. Preserve full-card/row native link semantics, accessibly named controls and proper focus.
- **Draft:** add Tag selections to NoteDraft itself, including normalization/equality, not a second save form. Tag-only draft is *ephemeral but staged*: no server mutations or “Saved” claim, and selection is not a meaningful create trigger. Read-only GET suggestions permitted. New-note custom navigation confirmation has Stay and Discard Tags and Leave, including browser Back and in-app routes. Browser refresh/close warning best effort. Untouched blank editor does not warn.
- **Save:** existing NoteSaveCoordinator must freeze POST body/key and confirmed baseline Tags. If Tag edits arrive while POST is in flight, reconcile create response without resetting editor and send a versioned PATCH only for newer *effective* changes; if user reverts, no redundant PATCH. Retain serial write guarantees, saving/failed state and confirmation-based conflict resolution for all title/body/Tag fields.
- **Validation:** a definitive Tag 400 shows specific actionable local Tag error and Save failed + Retry, retaining latest edits. Corrected POST gets new frozen request/key; definitive rejected PATCH snapshot is regenerated for the current draft on Retry using concurrency-safe expectedVersion; uncertain requests retain their old frozen identity.
- **Sessions:** reuse #71 memory-only owner-verified recovery for pending drafts, including Tag selections and frozen requests. Tag-only staging is also memory-retained across unexpected session expiry for verified same-owner return, without server writes. Explicit logout, owner switch and deliberate draft abandonment discard/hide it; stale asynchronous completions must not repopulate another user's UI or cache. Do not use localStorage, sessionStorage, IndexedDB or an offline store for draft contents.
- **Caching:** Note detail/list and Tag suggestion caches remain owner-scoped. Successful Tag creation through Note save invalidates shared owner-scoped Tag suggestions so Tasks can suggest the new Tag; no cross-owner data bleed.
- **UX wording:** staged new-name suggestion says “Add tag …” on Notes, not “Create …”; retain Task wording and Save/Cancel workflow.

## 6. Verification and acceptance matrix

**Backend tests:** same-owner Task→Note and Note→Task Tag reuse; case-insensitive identity; two-owner isolation across suggest/assign/list; missing vs foreign ID both generic 400; invalid names/shapes; zero writes for blank/tag-only POST; transaction rollback including created Tag and receipt; identical and reordered/case-varied POST retries; mixed ID/name key conflict; concurrent same-key create; PATCH omitted/[]/null; last association removed but Tag row retained; Tag-only version/updatedAt change and effective no-op; stale expectedVersion 409, including Tag-only concurrent PATCH; Inbox/archive unchanged; GET/detail/list sorted Tags and page-wise batch hydration without N+1; unaffected previews/counts.

**Frontend tests:** extracted selector keyboard, focus, duplicate and suggestion behavior; Task explicit Save/Cancel regression; new Note tag-only staged, no POST/resolve, owner-safe suggestions; custom Stay/Discard and best-effort beforeunload; first meaningful create includes staged Tags; in-flight create Tag edits result in serialized PATCH and no duplicate create; uncertain POST retains frozen key, definitive 400 uses fresh key after correction and manual Retry; whole-draft Keep/Load including Tags; same-owner expiry recovery including tag-only stage, account-switch/logout cleanup; owner-scoped suggestion cache invalidation; editor/card/list responsiveness and accessibility.

Use JUnit/Testcontainers/PostgreSQL with UTC JVM (`-Duser.timezone=UTC`), Vitest and Playwright; follow `Agents.md`, `server/AGENTS.md`, `client/AGENTS.md` and applicable local test skills. Report verification commands and exact blockers; do not claim unrun tests pass.

## 7. Documentation and execution boundary

The authoritative V1 PRD/Constitution reconciliation remains a **separate approved change**, not an automatic part of #72. Filtering FR-013 is tracked at [#89](https://github.com/krishna916/horizon/issues/89); Task filtering remains gated by #29. Keep Epic #8 open until feature completion is reviewed.

**Luna handoff:** read this design **and** the linked task-by-task [implementation plan](../plans/2026-11-11-notes-shared-tags.md) first. Use `superpowers:executing-plans` **inline/native, no subagents**, write failing tests before implementation, review/commit in small steps, stay on the approved #72 feature branch, and escalate any material requirement conflict or missing approval. Do not implement out-of-scope features, auto-merge, or rewrite PRDs unilaterally.
