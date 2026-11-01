# Issue #57 — Tag Public Contracts and Suggestions Design

**Status:** Owner-approved design (2026-11-01). **Issue:** https://github.com/krishna916/horizon/issues/57  
**Parent epic:** #8. **Prerequisite:** #56 (completed). **Consumer:** #27 (Task assignment), later Notes.

## Goal and boundaries

Expose small, reusable, owner-scoped Tag resolution/lookup/suggestions contracts through `tag.api`, and one authenticated read-only HTTP autocomplete endpoint. Task and Note relationship persistence and UI remain in their owning follow-up stories.

**In scope:** single-name create-or-reuse; owner-scoped ID lookup; fixed shared suggestions behavior; HTTP suggestions; safe concurrent resolution; domain-to-public validation translation; tests and security verification.  
**Out of scope:** Task/Note association tables, assignment endpoints, UI, general Tag browse/create/admin endpoints, rename/merge/delete, filtering UI, Search-by-tag, bulk resolution, tag lifecycle state fields, additional migrations unless a defect in #56 makes one necessary.

## Accepted contracts

```java
package com.krishnamurti.horizon.tag.api;

public interface TagCommandApi {
    TagReference resolveByName(Long userId, String name);
}

public interface TagQueryApi {
    Optional<TagReference> findById(Long userId, Long tagId);
    List<TagReference> suggest(Long userId, String prefix);
}

public record TagReference(Long id, String name) {}
```

- Both public interfaces belong to `tag.api`, implemented by internal Tag application services with Command/Query separation.
- `InvalidTagNameException` is a public `tag.api` runtime validation exception with a field/message contract; translate `tag.domain.InvalidTagException` at this boundary.
- Do not expose JPA entities, repositories or domain exceptions beyond Tag. Internal callers supply explicit, trustworthy `userId` obtained from their application boundary; Tag queries always scope by it. The shared API does **not** independently consult the security context.
- `findById` returns `Optional.empty()` for both absent and other-user IDs. Task assignment's 404 mapping and choosing IDs for existing tags/names for new tags are implemented in #27, **not** here.
- `resolveByName` is `@Transactional(propagation = MANDATORY)`; a caller must have an active enclosing transaction. It never starts `REQUIRES_NEW`. New Tag creation rolls back when the enclosing use case fails. Read queries do not require a preexisting transaction.

## Tag naming (inherit from approved #56)

Tag remains `Tag extends BaseEntity` (id/timestamps), scalar immutable `Long userId`, immutable display `name`; no status/inbox/archive/trash properties. Keep the existing PostgreSQL `(user_id, lower(name))` functional unique index. Name equivalence follows PostgreSQL `lower(name)` for the same user, **not** general Unicode case folding.

Name input: reject null, empty, whitespace-only and ISO controls (including tabs/newlines); trim edge code points matching Java `Character.isWhitespace` or `Character.isSpaceChar`; allow Unicode, symbols and internal spaces; maximum 100 Unicode code points **after trimming**. Preserve first persisted display casing/spelling. A new `Horizon` then `horizon` returns the same Tag ID/name for the same user, and different users may each own such a Tag.

Reuse #56's Tag validation semantics; if extracted into an internal helper, retain the existing `Tag.create` behavior and tests. Do not introduce a second, divergent naming policy.

## Concurrency and transactional semantics

Use parameterized PostgreSQL `INSERT ... ON CONFLICT DO NOTHING` (without a named conflict target: existing uniqueness is a functional index), then issue a **separate SQL statement** for owner-scoped `SELECT id, name` using `lower(name) = lower(?)`. Run in the caller's `READ COMMITTED` transaction. The second statement must observe the winner after any necessary unique-index wait; do not collapse to one CTE/statement with a potentially stale snapshot. Do not catch a unique-constraint exception and attempt to reuse an aborted transaction; no advisory locks or `REQUIRES_NEW`.

Normal result: one row per normalized owner/name; both concurrent callers receive the same usable Tag ID and originally stored display name. Persistence timestamps are set as in the #56 schema on a true insert and never rewritten on reuse. A rolled-back assignment must not leave a newly created Tag. Genuine foreign-key/SQL failures are not converted to name-validation errors.

Note: `MANDATORY` joins the caller's transaction but cannot force its isolation. The caller contract therefore requires `READ_COMMITTED` for create-or-reuse; if a real caller uses a different isolation and recovery fails, escalate before changing the approved approach.

## Suggestions through shared Tag Query

- `suggest(userId, prefix)` owns **all** validation, normalization, matching, sorting and limiting, so HTTP is a thin adapter and later Notes receives identical behavior.
- Trim leading/trailing whitespace using the same edge-space policy as Tag names; reject ISO controls, over-100-code-point input and null; after valid trimming, empty/whitespace-only returns empty list.
- Matching: case-insensitive **prefix** using PostgreSQL `lower(name)` semantics; escape SQL `LIKE` metacharacters `%`, `_`, and `\\` as literals, bind parameters, append a wildcard only for the intended prefix behavior.
- Ordering: `lower(name) ASC`, with stable tie-breaking (for example `name ASC, id ASC`); maximum **10**, fixed server-side, no `limit` parameter. One-character prefix is allowed. Never query another owner's Tag rows.
- Suggestions include persisted but currently unassociated Tags; they are still reusable under SPEC-002.

## HTTP read adapter

`GET /api/v1/tags/suggestions?q=hor`

Authenticated via existing session security. Resolve current user with `CurrentUserProvider` in the Tag web/application boundary, then call `TagQueryApi.suggest(userId, q)`. Do not accept any client-supplied user ID. No Tag create, resolve, ID GET or management route is introduced.

Success `200 OK`:

```json
{"items":[{"id":12,"name":"Horizon"},{"id":18,"name":"HorizonBackend"}]}
```

Response has a dedicated `items` envelope following `TaskListResponse`. Missing `q` => `400` RFC 9457 Problem Details. Present `q=` or ordinary-space-only => `200 {"items":[]}`. Reject control characters (including tab-only requests) and >100 Unicode-code-point prefix with `400` Problem Details. Unexpected errors should not become 400s. Unauthenticated request => `401`. A direct Tag ID GET endpoint is deliberately absent.

## Source reconciliation and authoritative boundaries

- SPEC-002 Tags v1.0 and SPEC-001 Shared Concepts (product specifications supplied for this issue) describe shared user-defined persistent Tags, no Tag lifecycle and automatic creation during content assignment. [Product context](../../ai/HORIZON_PRODUCT_CONTEXT.md) summarizes those accepted rules; #56 approved the actual owner-scoped name model.
- PRD-004's `Status` filtering describes derived **Task** states; it is no reason to add a Tag status enum. SPEC-001 content lifecycle fields apply to Task/Note, not Tag.
- The Constitution and [architecture context](../../ai/HORIZON_ARCHITECTURE_CONTEXT.md) require modular monolith, owner-scoped repository queries, public `tag.api` only, and RFC 9457 errors.
- [Engineering guide](../../ai/ENG-001%20Engineering%20Guidelines%20v1.0.md), [index](../../ai/INDEX.md), [repository guidelines](../../../Agents.md), and [server guidelines](../../../server/AGENTS.md) require thin HTTP adapters, command/query separation, Testcontainers, Maven verification, and current Java 25/Spring Boot 4.0.6/PostgreSQL 17 (older context documents mention Java 21; implementation controls).
- [#56 approved design](./2026-10-31-issue-56-tag-persistence-design.md) and existing Tag files/migration on `master` are the implementation baseline.

## Alternatives considered

- **Selected:** separate Command/Query public interfaces; TagReference (id,name); existing IDs versus new names for future Task assignment; owner-scoped explicit userId; PostgreSQL conflict-aware insert + separate read; MANDATORY transaction; shared fixed prefix suggestion contract; dedicated read-only HTTP URL.
- **Rejected for this story:** one combined TagApi; name-only assignment; batches; implicit current-user lookup inside shared API; advisory locking; error/result sum type; independent Tag commit; generic tag management; configurable or unbounded suggestions.

## Required proof before delivery

TDD checks: name validation and public exception translation; cross-owner ID absence and owner-scoped reuse; first display casing; new tag usable in suggestions; literal wildcard inputs, Unicode, spacing, maximum length, one-character prefix, empty query; deterministic alphabetical 10-item boundary; concurrent distinct real transactions return same ID with one row; failed assignment transaction removes newly inserted row; call without transaction fails MANDATORY; authenticated/missing/invalid `q` HTTP 200/400/401 and owner isolation; no cross-module internal imports. Use real PostgreSQL 17 Testcontainers and `./mvnw -Duser.timezone=UTC verify` from `server/`.

**No product code has been implemented by this design document.** The companion plan defines Luna's execution sequence. If implementation uncovers a genuinely new conflict, stop and ask the product owner rather than redefining the approved requirements.
