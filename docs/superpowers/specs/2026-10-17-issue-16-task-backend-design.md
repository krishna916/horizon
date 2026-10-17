# Issue #16 — Task Backend Design Specification

**Status:** Approved design consolidation for Luna implementation planning  
**Date:** 2026-10-17  
**Source issue:** https://github.com/krishna916/horizon/issues/16  
**Epic:** https://github.com/krishna916/horizon/issues/2  
**Approved UX reference:** `docs/design/tasks-workspace/DESIGN-SPEC.md` (commit `05fa90d`)  
**Product references:** PRD-004 Tasks; PRD-000 V1 Scope; SPEC-001 Shared Concepts; Horizon Constitution; existing architectural/engineering guides.

## Purpose

Provide the backend-only foundation for the Tasks workspace. An authenticated user can create, fetch, partially update, and list their own persisted tasks, with immutable per-user-readable keys and no frontend dependency. This is a **story-specific backend contract**, not a replacement for the approved UX design or later feature issues.

## Agreed decisions from design review

1. **Identity:** `task.id` remains the canonical globally unique BIGINT ID and `/tasks/{id}` the existing canonical route. Each user receives their own monotonically increasing `TASK-1`, `TASK-2`, ... key sequence. Identical task keys across users are valid. Enforce `UNIQUE(user_id, task_key)`. Never recycle the key of a committed task, including after soft deletion. Key-based URLs and user identifiers in URLs are deferred; do not change current routes.
2. **Key allocation:** a Task-owned per-user counter, updated atomically inside task creation's DB transaction. Concurrent creates must not duplicate keys; do not use `MAX()+1`. The counter belongs to the Task module, not User.
3. **Description:** nullable PostgreSQL JSONB holding a Tiptap/ProseMirror-compatible document. An accepted non-null envelope is a JSON object with `"type":"doc"` and a `"content"` array; preserve nested JSON. Reject invalid envelope shape. Rich-text node schema, editor, rendering and sanitizer are explicitly issue #24.
4. **Update semantics:** `PATCH /api/v1/tasks/{id}`, only supplied editable properties change; omitted properties are preserved; explicit JSON `null` clears optional properties. Immutable fields and lifecycle timestamps are not editable through PATCH. Lifecycle commands are separate future stories.
5. **Due date:** nullable date only (`LocalDate`, PostgreSQL `DATE`, `YYYY-MM-DD` JSON), no time or timezone.
6. **List:** `GET /api/v1/tasks` returns all **non-deleted** tasks belonging to the user, including active/completed/archived. Do not implement server-side filters or pagination in #16; revisit server-side filtering in #29.
7. **Ordering:** deterministic newest-first, `created_at DESC, id DESC`. This supersedes PRD-004's older due-date-first default, following the approved 2026-10-10 UX design. More sorts are separate issue #26.
8. **Title:** required; strip leading/trailing whitespace; reject null, blank, and normalized length above 255; preserve internal spaces and capitalization; same invariant on create/update.
9. **Shallow vs detail:** list returns a Task-specific summary DTO, excluding rich-text description. Detail and successful creation/update return a complete Task DTO. Treat shallow list / rich detail as a future cross-feature convention, without a generic DTO hierarchy.
10. **Collection envelope:** `{"items":[...]}`; no speculative page metadata or generic wrapper infrastructure.
11. **Priority:** nullable, user-managed `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, or none; keep the accepted numeric `priority_id SMALLINT` persistence convention. Concrete ordinal-independent numeric codes are a local representation detail documented in the plan.
12. **Ownership:** record authenticated user's `Long` ID on Task. All fetch/update/list repository queries must scope by user ID. Nonexistent and cross-user IDs produce indistinguishable 404 responses; all task endpoints require authentication.
13. **Persist lifecycle facts:** `completed_at`, `archived_at`, `deleted_at` nullable from day one, without implementing completion/archive/delete transitions in #16. `inbox=false` on workspace creation. The Task module must remain compatible with later global Capture, Today, and Trash.

## Functional boundaries

### Included

- Task aggregate, Task-owned repository and key counter, Flyway SQL migration and required indexes/constraints.
- POST, GET by numeric ID, PATCH by numeric ID, GET collection under `/api/v1/tasks`.
- Ownership isolation, data validation, RFC 9457 Problem Details, correct transaction boundaries.
- Postgres Testcontainers schema, repository, concurrency and authenticated API tests.

### Excluded

- All frontend changes (later #17, #18, #19 and #20).
- Completion/reopening (#21), checklist (#22), archive/restore/soft delete actions (#23).
- Rich-text editor/rendering and full node schema (#24); sorting UI/query parameters (#26); tags (#27); Search (#28); server-side filtering (#29).
- Attachments (#30), activity history (#31), key-based URLs, future project prefixes, Inbox Capture implementation, pagination, background jobs, generic query frameworks.

## Data model

```text
task
  id                BIGINT IDENTITY PK
  user_id           BIGINT NOT NULL FK -> users(id)
  task_key          VARCHAR(64) NOT NULL
  title             VARCHAR(255) NOT NULL
  description       JSONB NULL
  priority_id       SMALLINT NULL
  due_date          DATE NULL
  inbox             BOOLEAN NOT NULL DEFAULT FALSE
  completed_at      TIMESTAMPTZ NULL
  archived_at       TIMESTAMPTZ NULL
  deleted_at        TIMESTAMPTZ NULL
  created_at        TIMESTAMPTZ NOT NULL
  updated_at        TIMESTAMPTZ NOT NULL
  UNIQUE(user_id, task_key)

task_key_counter
  user_id           BIGINT PK FK -> users(id)
  last_allocated    BIGINT NOT NULL CHECK(last_allocated >= 1)
```

Task is the aggregate root. `task_key_counter` is infrastructure, **not** a separate aggregate or global shared concept. Keep owner ID scalar in Task rather than importing User's domain entity (module boundary). Follow BaseEntity's existing lifecycle callbacks for creation/update timestamps. Database schema is Flyway-managed, JPA validates it.

### Key transaction

Inside the same transaction as `TaskCommandService.create`, execute:

```sql
INSERT INTO task_key_counter (user_id, last_allocated)
VALUES (:userId, 1)
ON CONFLICT (user_id)
DO UPDATE SET last_allocated = task_key_counter.last_allocated + 1
RETURNING last_allocated;
```

Then format `TASK-<allocated number>` and insert Task. PostgreSQL row-level conflict handling serializes allocation for the same owner. Rollback of failed creation rolls back the counter update; numbers may be reused after a **failed transaction**, but never after an existing saved task is deleted. Unique `(user_id, task_key)` constraint provides the final DB safety net.

### Priority representation

Use an explicit reversible numeric mapping independent of enum ordinal: `CRITICAL=1`, `HIGH=2`, `MEDIUM=3`, `LOW=4`. This is a schema-level internal code convention, not a new product feature. It is deliberately fixed here so future migrations will not depend on Java enum declaration order. SQL CHECK allows only 1–4 or NULL.

## HTTP contracts

Endpoints are authenticated and mounted at `/api/v1/tasks`.

| Method | Path | Result |
|---|---|---|
| `POST` | `/api/v1/tasks` | `201 Created`, `Location: /api/v1/tasks/{id}`, TaskDetailResponse |
| `GET` | `/api/v1/tasks/{id}` | `200 OK`, TaskDetailResponse or indistinguishable `404` |
| `GET` | `/api/v1/tasks` | `200 OK`, TaskListResponse `{"items": [...]}` |
| `PATCH` | `/api/v1/tasks/{id}` | `200 OK`, TaskDetailResponse or `404` |

Create request (optional fields may be omitted):

```json
{"title":"Renew passport","description":{"type":"doc","content":[]},"priority":"HIGH","dueDate":"2026-10-20"}
```

PATCH examples:

```json
{"priority":"HIGH"}
```

```json
{"description":null,"dueDate":null}
```

Neither may overwrite ID, key, owner, inbox, creation timestamp, or lifecycle facts. Reject unsupported PATCH field names (especially attempts to mutate immutable/internal fields) with 400, not silently ignore them. An empty update object is invalid. JSON `null` for title is invalid.

Task summary response fields: `id`, `key`, `title`, `priority`, `dueDate`, `inbox`, `completedAt`, `archivedAt`, `createdAt`, `updatedAt`. Do not include description or `deletedAt` (the collection excludes deleted records). Task detail response adds `description` and `deletedAt`; it may return null lifecycle timestamps. Do not expose `userId`, key counter or internal numeric priority codes to clients.

**Failure behavior:**
- `400` + existing standard RFC 9457 validation Problem Details (including `errors` for field validation) for blank/overlength title, invalid priority/date, malformed JSON, invalid description envelope, or unsupported PATCH fields.
- `401` for unauthenticated requests, using existing Spring Security conventions.
- `404` (indistinguishable response) for missing or other user's task ID; no owner-identifying data in error detail.
- `500` for unexpected failures using existing centralized handling (never leak SQL/secrets).

## Validation and data integrity

- Normalize titles before persisting and enforce at the domain boundary; basic request constraints at HTTP boundary.
- For descriptions only validate the top-level `doc` envelope and that `content` is an array. Preserve nested data (including extension nodes) to permit rich editing in #24. Do not claim that minimal envelope validation makes rendering safe.
- Preserve `null` vs omitted PATCH properties. JSON document content is replaced atomically when `description` is supplied; no path-level JSON patching.
- Use `@JdbcTypeCode(SqlTypes.JSON)` with PostgreSQL `jsonb` and a JSON-compatible object representation; ensure Hibernate 7/Jackson 3 serialization round-trips in an actual PostgreSQL test, not H2.
- Creation is always workspace creation and therefore sets `inbox=false`. Add no implicit Tag, Checklist Item or Attachment record.
- `updated_at` changes for persisted edits; ID, readable key, owner and `created_at` stay stable.

## Testing and delivery

- Unit tests cover normalization, invalid titles, description envelope, patch field handling, immutable identities.
- Integration tests cover Flyway migration, ID/key constraints, JSONB round trip, `LocalDate`, owner-scoped queries, newly created counters, two users with identical readable keys, concurrency, 404 isolation, unauthenticated calls, null clearing and omission-preserving PATCH.
- Prefer existing PostgreSQL Testcontainers, MockMvc and session-cookie login patterns. Do not replace them with H2.
- Build gate: from `server/`, `./mvnw verify` (including existing formatting/static-analysis configuration); test runs require Docker.

## Risks and future contracts

- **Future key routes:** `TASK-1` is not globally unique. Any future readable-key route needs an owner/user scope; do not conflate key with the numeric canonical ID.
- **Future rich text:** the API stores structured JSON now, but issue #24 must define a versioned editor schema and safe renderer later.
- **Future list scale:** unpaginated shallow responses are an explicit V1 choice. Later server filtering/pagination must preserve the envelope and determinism.
- **Future Trash:** preserve `deleted_at` and completion/archive facts on Task; issue #23 owns transition rules. No delete action is introduced by this story.
- **Documentation:** PRD-004's older sort default conflicts with approved design; note supersession and update the appropriate product document in the relevant follow-up rather than silently rewriting product history during #16.

## Approval status

All product/architectural options above were selected or explicitly approved in the planning conversation ending 2026-10-17. This specification consolidates those decisions for Luna. Details such as the priority numeric mapping, HTTP success status and immutable-field rejection are narrow implementation contracts recorded explicitly here for review—not permission to expand scope. If the current repository contradicts one of these, stop and ask rather than silently overriding accepted behavior.
