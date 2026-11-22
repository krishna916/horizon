# Proposed authoritative amendment — HORIZON_CONSTITUTION v1.0

**Status:** WORDING APPROVED on 2026-11-22. The corresponding authoritative Constitution amendment is staged in [knowledge-store draft PR #1](https://github.com/krishna916/horizon-knowledge-store/pull/1), **merged to `main`** (commit [`631e2a8`](https://github.com/krishna916/horizon-knowledge-store/commit/631e2a81e00f8816d983fdca3b289a903f2cc3b3)). This remains a review proposal, not the accepted Constitution.

**Inspected source:** `50-AI/ChatGPT Context/HORIZON_CONSTITUTION.md`, Accepted v1.0, SHA-256 `2e70915a929d69165dc89d5e47e56725888a26be5854c8a4fd5b658289dc83c5` (uploaded project source). Reverify its latest revision before application.

**Approved basis:** [#68](https://github.com/krishna916/horizon/issues/68), [#55](https://github.com/krishna916/horizon/issues/55), [#75](https://github.com/krishna916/horizon/issues/75), [draft File ADR](../../adr/ADR-DRAFT-shared-file-object-storage.md). Only lasting cross-cutting invariants belong here; details stay in the PRD and ADR.

## 1. `2.4 Navigation Model → Object Navigation`

**Replace** the universal `List → Side Panel → Full Page` with:

> **Tasks:** List → Side Panel → Full Page, retaining contextual inspection and return-to-origin.
>
> **Notes:** Cards/List → Full Page **directly**, with no intermediate Note side panel. This is an approved Notes-specific exception.
>
> Canonical object routes, browser history and origin preservation apply to both workspaces.

Keep primary navigation, global Search and Tasks behavior unchanged.

## 2. `2.5 Module Responsibilities → Notes`

**Replace** “Notes — Represents Information Management; Owns Notes” with:

> **Notes** represents Information Management. Owns Note content/document, owner/lifecycle authorization, Note–File association and its inline-image versus attachment presentation role. It uses the shared File module's public API for byte transfer and cleanup. Notes V1 includes approved images/attachments without an independent Files workspace.

Keep specific Note editor/preview/removal UX in PRD-005.

## 3. `3.1 System Architecture → High-Level Structure`

**Append:**

> Binary content uses one **private S3-compatible object store per deployment**, accessed only through the shared File module using AWS SDK Java v2. Self-hosted deployment prefers a persistent single-machine SeaweedFS service, verified for tested interoperability in #75. Provider selection belongs to deployment configuration, not user/workspace settings. PostgreSQL retains File metadata and durable cleanup work. S3 operations do not participate in database transactions; no extra distributed broker or worker service is introduced for V1.

Keep modular monolith, PostgreSQL/Flyway, layering and operational simplicity unchanged.

## 4. `3.2 Module Architecture → Module Categories / Ownership / Communication`

**Append a shared technical capability** without changing existing workspace/capability categories:

> **File (shared technical module):** owns File UUID, physical object bytes, validation/transfer, exclusive one-time claim, durable technical attempts, tombstones and cleanup/reconciliation. It is **not** a user-facing Files workspace and does **not** own Note business authorization or presentation role.

**Append under ownership and communication:**

> Content modules own their association records (e.g. Note-owned `note_file`) and call `file.api`. Repositories remain module-private. One-time File claim, Note association, any inline reference insertion and Note optimistic version update occur atomically in the caller's PostgreSQL transaction. S3 transfers occur outside that transaction. No polymorphic owner or cross-table trigger is implied.

No new Java signatures, table columns or lock ordering are approved here.

## 5. `3.3 Identity Strategy` and `3.6 Identifier Strategy`

**Append at both existing BIGINT identity passages:**

> **File-only exception:** File identity is an opaque UUID, independent of its owning Note BIGINT ID. Possession of the UUID or S3 key is not authorization. All existing non-File identity defaults remain BIGINT / Long / number.

Do not migrate User/Task/Note/Tag identity types.

## 6. `3.3 Lifecycle Philosophy`

**Append:**

> Note–File association lifecycle uses factual prepared/attached/removed timestamps, not an extra Note business-status enum. File transfer, UNKNOWN results and cleanup may use a **technical recovery state** because S3 cannot share a PostgreSQL transaction. This is internal reliability machinery, not a user-facing content lifecycle.

## 7. `3.6 Persistence` and `3.8 Security`

**Append File-specific invariants:**

> Each **new network PUT** uses a **never-reused, generated physical object key** whose attempt metadata is committed to PostgreSQL **before upload**. Logical idempotency identity remains stable while physical transfer attempts use distinct recorded keys.
>
> A lost response, timeout or crash without authoritative S3 settlement leaves a durable UNKNOWN attempt. The in-process reconciler retries inspection and cleanup across restarts. **Do not discard the UNKNOWN locator** merely because of a timeout, 24-hour staged expiry, lease expiry, successful DELETE or negative HEAD. If remote settlement cannot be proven, retain/reconcile the locator **indefinitely**. Compact only safely terminal attempts, retaining minimal tombstones for idempotent non-resurrection.
>
> Access to any file byte is owner-authorized via the associated content object and authenticated Note-scoped route; object keys and File IDs are not credentials. Archive/Trash retain associations and bytes; ordinary trashed-file routes deny access. Individual confirmed removal or future parent permanent deletion triggers eventual physical cleanup.

Exact DDL, lease/fencing, retry schedule, provider pin and REST contract remain #76/#77 implementation-level review items.

## 8. `4.5 Documentation Strategy` / `5.4 Knowledge Repository` / `5.5 Source of Truth`

Keep the knowledge repository as the authoritative home for Constitution, PRDs and other documents, and **do not change the existing hierarchy** (implementation → Constitution → PRD → ADR → history).

**Append a narrow exception:**

> **File ADR only:** The approved shared File/object-storage ADR is maintained in the **Horizon application GitHub repository** at `docs/architecture/adr/` and is authoritative **for that File ADR only**. The knowledge repository holds a link/pointer to it. This is **not** a policy to migrate all ADRs or an exception to document precedence.

## 9. Governance, application and non-changes

Once explicitly approved, apply these narrow changes to the **authoritative knowledge-repository Constitution** with reviewed version/status amendment and, separately, sync any AI context mirrors that need to reflect accepted decisions. This proposed file itself has no authority.

Do **not** change Task navigation, the general BIGINT rule, Tag/Search ownership, auth/security defaults, the modular-monolith architecture, general document-precedence order or Trash's archived-state restoration. The selected V1 recovery direction needs actual production worker proofs under #76/#77 and is not equivalent to accepting the draft ADR.
