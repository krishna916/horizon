# ADR (Draft): Shared File Storage and Note-Owned Attachments

| Field | Value |
| --- | --- |
| Status | **Draft / proposed — NOT ACCEPTED** |
| Decision review | D-01 through D-29 individually approved in Horizon #75 discussions |
| Date | 2026-11-22 |
| Scope | Horizon V1, Notes-first shared File capability |
| Authoritative location | This GitHub repository's `docs/architecture/adr/` for **this File ADR only** (D-04, D-24) |
| Evidence gate | **POC executed and documented:** A01–A16 and B01–B13 (29 JUnit methods passed as reported by PR #94); production UNKNOWN-attempt recovery **NOT APPROVED** |
| Approval gate | Selected post-POC recovery direction to be documented/reviewed; explicit ADR acceptance and source-document reconciliation still pending |

> **Do not interpret the completed POC as proof of production cleanup guarantees or acceptance of this ADR.** Approved D-01–D-29, the post-POC recovery direction, and pinned-provider observations are documented here. Final SQL/HTTP contracts, implementation-level locking/scheduling, source-document reconciliation and ADR acceptance are separate review gates. This document remains on a review branch.

## 1. Context and problem

Horizon is a Spring Boot modular monolith using PostgreSQL/Flyway. Notes V1 must support **inline images and regular attachments**, with owner-only access, predictable autosave, Archive/Trash retention, and durable eventual cleanup. Future Tasks, Journal or other content-owning modules may reuse storage, but **no additional workspace integration is authorized now**.

Existing Notes use BIGINT identity, JSONB Tiptap documents and optimistic `version` concurrency. Existing shared principles require modules to communicate through `module.api` and inaccessible resources to return 404. The approved Notes UX (#68) uses Card/List browsing and a **direct full-page editor**, unlike the generic side-panel-first pattern. A first image/file may create a Note, but merely opening an untouched editor or choosing Tags alone must not.

Object storage cannot participate in the same PostgreSQL transaction. A successful S3 PUT followed by a failed DB commit, a lost PUT response, or a late PUT racing with cleanup can leave bytes untracked unless lifecycle/reconciliation is designed carefully. #75 is a **technical design and proof gate**, not a production delivery story.

### Design goals

- Preserve one clear storage implementation for self-hosted and cloud deployments.
- Keep ownership and authorization in the content workspace, with one shared File module for technical storage.
- Support secure, independently retryable uploads and honest UI failure states.
- Enforce one-time File claim across different future workspace association tables.
- Ensure logical inaccessibility at committed removal and eventual, crash-safe physical cleanup.
- Minimize infrastructure for a solo-maintained modular monolith; earn complexity through proof.

## 2. Architecture decision

### 2.1 Storage topology and deployment

Use **AWS SDK for Java v2** as the single S3 API integration in all environments. Self-hosting prefers a **single-machine, persisted SeaweedFS S3 endpoint**; the isolated #75 POC has **demonstrated interoperability for the pinned SeaweedFS 4.54 and AWS SDK v2 2.59.2 test configuration**. Production recovery and the final ADR remain subject to separate approval. Cloud deployments may select AWS S3 or another proven compatible provider through deployment-wide endpoint, region, credentials and bucket configuration. **Provider switching is not data migration.**

Use **one private bucket per deployment**, with generated opaque keys in the approved form:

```text
users/{userId}/{workspace}/{generatedFileKey}
```

Preserve original filenames in PostgreSQL only. Never use an object key prefix or possession of a File UUID as authorization. Do not expose browser-direct S3 URLs, public objects or presigned browser flows for V1.

### 2.2 Module responsibility

```text
Authenticated Notes editor / Note-scoped REST
                 |
                 v
          Note module
    - owner / lifecycle authorization
    - note_file (pending and attached)
    - presentation role and editor references
    - optimistic Note version and mutation
                 |
           file.api only
                 v
          File module
    - File UUID and metadata
    - idempotent upload lifecycle
    - safe byte validation / S3 adapter
    - one-time claim
    - cleanup / durable retries
                 |
        AWS SDK for Java v2
                 v
        Private S3-compatible bucket
```

**File module** owns storage identity, bytes, file validation, technical lifecycle and eventual physical deletion. **Note module** owns Note authorization, reservation/association data, document references, role, and Note version. The Note module invokes `file.api`; neither module directly accesses the other's repositories. There is no independent Files workspace or cross-note sharing.

### 2.3 Exclusive claim across future workspaces

Each File belongs to exactly **one content object** and is claimed **once**. File's central durable record mediates an atomic conditional claim, transactionally coordinated with the calling workspace's association change. A later `task_file` or `journal_file` must use the same claim API; per-table uniqueness alone cannot enforce cross-table exclusivity.

A single File may be referenced **multiple times within one owning Note's document** (D-08), but it cannot be attached to another Note or presented both as a regular attachment and an inline image. The latter is a **Note-owned presentation role**, not File-domain business state.

**Do not infer approval for a polymorphic typed owner column, cross-workspace database triggers, or a specific locking implementation.** The central one-time claim invariant is approved; exact constraints and transaction/lock ordering are pending story-level review.

## 3. Approved decision register (D-01–D-29)

These are **approved decisions**, not candidate alternatives. More detailed rationale and test requirements appear in #75.

| ID | Approved outcome | Rationale / constraint |
| --- | --- | --- |
| D-01 | Central, atomic **one-time File claim** in caller's PG transaction | Cross-workspace exclusivity without coupling association repositories |
| D-02 | Each binary is **strictly <20 MiB**, maximum **20,971,519 bytes** | Explicit non-inclusive boundary; no aggregate quota |
| D-03 | File association mutations participate in Note optimistic `version` | Autosave and attachment changes cannot silently race |
| D-04 | This File ADR lives in Horizon's GitHub `docs/architecture/adr/` | Narrow documented exception to knowledge-repository policy |
| D-05 | If first-file upload fails, keep the otherwise-empty persisted Note | Allow retry; untouched/tag-only drafts still create nothing |
| D-06 | Transfer bytes separately; **claim + association finalize atomically** | No S3 upload inside DB transaction |
| D-07 | Stable UUID upload idempotency key with incompatible replay rejected | Same logical attempt across retries |
| D-08 | Allow repeated inline references to one fileId **in the same Note** | Reference-aware removal; no cross-note reuse |
| D-09 | Inline reference insertion, claim, association and Note version commit together | No saved dangling image references |
| D-10 | Keep successful staged bytes after a Note-version conflict | Rebase/retry finalization without uploading bytes again |
| D-11 | Expose File identity as opaque **UUID**, independent of BIGINT Note ID | Purposeful File-specific identity exception |
| D-12 | A File has one presentation role: attachment **or** inline image | Prevent role-sharing/deletion ambiguity |
| D-13 | Presentation role lives in Note association | File module stays workspace-agnostic |
| D-14 | File lifecycle record is the **durable work queue** | No extra generic job framework or broker |
| D-15 | Staged File is bound to the originating Note before finalization | Same user's other Notes cannot claim it |
| D-16 | Configurable unclaimed-stage expiry, **default 24 hours** | Bounded retry window and abandoned-byte cleanup |
| D-17 | One Note-owned `note_file` relation represents pending/finalized bindings | Avoid extra Note intent table for V1 |
| D-18 | No File→Note expiry callback; Note ignores/prunes expired pending associations | Keep module dependency one-directional |
| D-19 | Retain minimal File tombstones after cleanup | Stop late idempotent retries from resurrecting File |
| D-20 | Explicit **prepare → transfer → finalize**, plus inspect/retry | Recover individual stages independently |
| D-21 | Extend existing **idempotent Note creation** with explicit file-first intent | No parallel create flow; supports image/file-only Notes |
| D-22 | Use **factual timestamps** for Note association phases | Do not add a `note_file` business status enum |
| D-23 | Clear unnecessary sensitive metadata **after physical deletion confirmed** | Preserve locator/retry information until cleanup succeeds |
| D-24 | GitHub ADR location is **File-specific**, not general ADR policy | Avoid undocumented documentation-governance expansion |
| D-25 | Prepare/transfer **do not** increment Note version; finalize/remove **do** | Technical reservation is not visible Note edit |
| D-26 | Require known upload length; independently verify observed bytes | Bounded predictable transfer, no unknown-length pathway |
| D-27 | Require client SHA-256 at prepare; server checks actual bytes | Enforce same-content identity through transfer/retry |
| D-28 | **Explicit confirmed Note mutation** for inline-image removal | Ordinary rich-text PATCH cannot silently remove occurrences |
| D-29 | **Bounded temporary staging and full validation before S3 PUT** | Unsafe/invalid files never enter persistent object storage intentionally |

## 4. Data model: approved invariants versus proposed shape

### 4.1 File-owned durable metadata

A File record requires an opaque UUID, owning user, private object locator, original filename, validated format/size, client-declared SHA-256 and actual verification result, stable upload request identity/fingerprint, staged expiry, claimed/cleanup facts, and technical lifecycle/retry information sufficient for recovery.

The same record is the durable work queue (D-14). Implementation must support restart-safe scheduling and a safe response to uncertain S3 PUTs; **exact technical states, leases/fencing, retry intervals, indices and final Flyway DDL are not approved**. A timestamp representing claim or deletion is a fact, not proof that remote bytes were actually deleted.

### 4.2 Note-owned binding

One `note_file` relation binds one File UUID to one Note BIGINT ID, including a **pending reservation** before transfer and a **finalized association** after a valid claim. The association owns exactly one role (`ATTACHMENT` or `INLINE_IMAGE`) and uses factual timestamps such as prepared/attached/removed (exact column names not yet chosen). Its `file_id` must be unique in the Note table; cross-workspace uniqueness is enforced by File's atomic claim API.

**Pending does not mean readable.** A pending, expired, removed or otherwise unclaimable File cannot be downloaded or previewed. File identity/idempotency tombstones must remain compatible with relational references; metadata needed for a pending physical delete cannot be purged before S3 confirms deletion.

### 4.3 Note record

Continue to use existing BIGINT `note.id`, JSONB rich-text content, and optimistic `version`. No change to Note's identity strategy is implied. Image nodes store stable **fileId references**, not S3 URLs or binary payloads. A Note-only content PATCH must validate existing/new/missing image occurrence counts against authorized associations.

The current Note implementation rejects empty title/body creation and excludes `image` from the safe Tiptap subset. #78/#79 must extend these **narrowly** for controlled file-first creation and secure image references without relaxing unrelated content validation.

## 5. State transitions and transactional contract

### 5.1 File-first Note creation

1. An untouched editor or tag-only draft remains local; no Note is created.
2. On first file/image selection, create the persisted Note using the existing idempotent Note creation flow with an explicit file-first intent; include staged Tags according to the approved UX.
3. Keep this Note even if the subsequent upload fails (D-05).
4. Prepare the File identity and pending Note association; transfer only after the Note ID exists.

### 5.2 Prepare / transfer / inspect / finalize

- **Prepare:** authorize originating Note, validate declared file information, known byte length and required client SHA-256, persist idempotent File identity and Note-bound pending association. **Do not bump Note version** (D-25).
- **Transfer:** stream into a **bounded temporary local staging file**. Verify actual byte count, SHA-256, format signature/structure and approved allowlist before a known-length S3 PUT. Local staging is disposable processing, not a parallel persistent storage backend. Capture uncertain remote outcomes durably; **do not mark a timed-out PUT absent or safely stored without reconciliation**. **Do not bump Note version.**
- **Inspect/retry:** report the existing logical upload or terminal tombstone for the same idempotency identity. Mismatched user/Note/role/metadata/length/checksum is a conflict. Do not create duplicate identities or reinterpret an expired retry as a new upload.
- **Finalize:** lock/authorize the Note, verify current expected version, pending binding, valid stored File and expiry; **atomically** claim File once, finalize Note association, insert inline image reference if applicable, and advance Note version. No S3 request occurs inside this PostgreSQL transaction.
- **Version conflict:** reject stale finalization; retain staged bytes for subsequent reconciliation/rebase/retry **without overwriting a newer Note document** (D-10).
- **Lost finalize response:** replay/inspect must not double-claim or double-increment Note version; precise response shape remains pending.

These are architectural guarantees, **not approved HTTP route names or Java method signatures**.

### 5.3 Removal, reference counts and parent lifecycle

- A regular attachment or any inline-image occurrence requires **user confirmation** before a destructive mutation. Cancel changes nothing.
- A protected image occurrence removed through keyboard, cut, selection replacement or editor history must not evade confirmation. Ordinary Note content PATCH rejects an unauthorized decrement in protected inline-image reference count (D-28).
- Explicit removal must persist the revised Note/document/version and logical detach plus durable File cleanup intent atomically. **If the save fails, keep the file and saved document unchanged.**
- Removing one of multiple inline references keeps the File attached and the object bytes intact. Only removing the **final** occurrence requests physical cleanup. File cannot simultaneously serve as a regular attachment.
- After logical removal commits, normal routes deny the File; S3 deletion may happen asynchronously with retries. "Removed" does **not** mean irrevocably erased from backups or storage immediately.
- **Archive:** retain associations and bytes; owner may continue viewing/editing archived Notes. **Trash:** retain bytes but deny ordinary Note/file routes. **Restore:** preserve same file IDs, content and original Archive state. **Permanent parent deletion:** defer user-facing behavior to Global Trash Epic #9; it must use the shared durable File cleanup API.

## 6. Validation, privacy and content serving

### 6.1 Upload validation

Allowed initial types: JPEG/JPG, PNG, WebP, GIF; PDF; DOCX, XLSX, PPTX; TXT, MD, CSV; standalone Mermaid (`.mmd`, `.mermaid`). Validate server-side signatures and format structure where meaningful, not merely extension or browser MIME. Reject active HTML/SVG, executables, macro-enabled Office formats, spoofed/malformed packages and unsafe payloads. Exact signature rules and selected validation libraries are #76 implementation-review details.

Reject unknown-length streams, any observed/declaration length mismatch, file size **greater than or equal to 20,971,520 bytes**, and SHA-256 mismatch. Bound temporary storage, concurrency, permissions and memory; clean temporary files after success, failure and crash. Local capacity failures should be user-visible failures, not corruption or a loss of already-saved content.

### 6.2 Download and preview authorization

All reads originate from **authenticated Note-scoped Spring Boot routes**. Require authenticated user ownership of the specific Note, allowed Note lifecycle, finalized/active matching association, File technical accessibility and correct presentation role. Foreign/unrelated/pending/expired/trashed/removed requests use generic owner-safe 404 handling. Do not expose raw S3 URLs, arbitrary keys, file metadata to unauthenticated callers, or direct presigned browser access.

Use safe file response headers and types (including `nosniff`, appropriate private cache controls, safe Content-Disposition and sanitized filename handling). Never serve untrusted HTML/SVG as active content.

### 6.3 Preview format policy (approved product scope)

Use #68's **attachment preview modal** from the full-page editor. Support image preview and native PDF viewing; render uploaded Markdown read-only with sanitized embedded Mermaid, and render standalone Mermaid diagrams safely. DOCX/XLSX/PPTX and TXT/CSV are download-only initially. Offer original download for all allowed types. Markdown/Mermaid **authoring inside Note editor is not part of this feature**. Detailed sanitization and browser security tests belong to #80.

## 7. Crash consistency, expiry and POC gate

**Approved V1 recovery direction (post-POC): attempt-specific object keys and durable PostgreSQL attempt tracking, with conservative retention/reconciliation of UNKNOWN outcomes.** This is an architecture policy, not proof that every delayed S3 write can be bounded. Upload identity, 24-hour logical staged expiry, one-time claim, cleanup, tombstone and concurrent workers still require a coherent production implementation.

A timeout does not establish whether an S3 PUT succeeded. An apparently absent object may be written later by an already-started transfer. Deleting a key while a previous PUT remains in flight can recreate the object after cleanup. **Conditional S3 PUT alone does not solve late write after DELETE**, demonstrated in #94. V1 therefore **does not rely on a single reused physical key or a time-based assumption of S3 write settlement**. See §7.2 for the selected conservative recovery approach.

### 7.1 #75 isolated POC — executed and reported (experimental evidence)

The standalone POC used a **pinned SeaweedFS 4.54 image/digest**, AWS SDK Java v2 **2.59.2**, private test bucket, test credentials, path-style endpoint, persistent dedicated volume, Java Testcontainers and controlled TCP fault gates. It did not use customer data or implement the production File module. The reported clean-checkout run at commit `d5d3132eee8e9102fdc95e32a55d919d557d3d62` executed **29 distinct JUnit methods with 0 failures/errors/skips**, plus four repeated runs of the S3 fault test class. Those results and sources are recorded in [the permanent evidence summary](../validation/ISSUE-75-SEAWEEDFS-S3-POC-REPORT.md), with [full runnable harness and detailed evidence in PR #94](https://github.com/krishna916/horizon/pull/94).

**Layer A — provider/S3 operations A01–A16:** bucket bootstrap/authentication and privacy, ordinary Put/Head/Get/Delete with independent SHA-256 readback, restart persistence, conditional writes and concurrent writers, unavailable endpoint, interrupted PUT, **lost response after verified commit**, service restart during transfer, PUT-vs-DELETE interleavings, and missing-object classification. Size/checksum policy is measured in the application validation harness rather than assumed to be S3-enforced.

**Layer B — recovery-protocol behavior B01–B13:** persisted intent/crash, S3 success followed by DB failure, repeat/mismatched upload requests, Note version conflict, concurrent claim, **expiry versus late PUT**, logical deletion with failed remote DELETE, tombstone non-resurrection, lost finalize response, protected image PATCH, duplicate image references and Archive/Trash/restore behavior.

See [#75's proof matrix](https://github.com/krishna916/horizon/issues/75) for case-by-case criteria. Results are summarized in the [POC evidence report](../validation/ISSUE-75-SEAWEEDFS-S3-POC-REPORT.md) and supported by the [committed PR #94 harness, reports and observations](https://github.com/krishna916/horizon/tree/9afce16dde1911f96933f13434b47fac3ce17165/server/poc/s3-compat). **A12** showed provider HTTP 200 followed by a lost client response; **A14** found late objects after DELETE in **4/5** controlled attempts and **A15** in **20/25** conditional attempts. A passing hazard test means the risk was reproduced, **not** that cleanup is safe. **B07** showed one delayed upload recovered and removed with durable attempt tracking, but a finite safe retirement rule for indefinitely UNKNOWN attempts was **not proven**. B11–B13 were behavioral models only.

The POC source report records test class/case mapping, versions, run IDs, fault barriers, S3 responses, direct S3 inspection, selected checksums and PostgreSQL model observations. The tests were not independently rerun during architecture review. A nondeterministic timeout without verified server-side commit remains **inconclusive** as to actual remote outcome.

### 7.2 Selected V1 recovery policy — post-POC architecture direction

**Decision:** For new network transfers, use **an immutable, never-reused S3 object key per transfer attempt**. Keep the **logical upload idempotency UUID** stable across retries. Persist every attempt's UUID, generated physical key, expected content fingerprint, owning logical request and durable technical outcome **before** issuing its S3 PUT. No physical transfer may begin without a committed attempt locator. Retried *inspection/finalization* may refer to a prior attempt, but any **new PUT operation** uses a newly recorded attempt ID and key. Earlier attempts must remain independently discoverable. **Implicit SDK retries are not exempt:** #76 must ensure the Java S3 client's behavior cannot issue an untracked second PUT against the same key; either disable automatic write retries or explicitly coordinate each network retry as a newly persisted attempt. The exact implementation is subject to #76 review.

**Unknown results:** Any timeout, broken connection, lost response or crash that does not authoritatively settle the PUT leaves its attempt **UNKNOWN** (or equivalently non-terminal) in durable PostgreSQL state. A lightweight in-process File cleanup/reconciler periodically checks and, when logically expired/removed/unclaimed, deletes objects under those recorded keys. It keeps retrying across restarts and temporary storage failures. Cleanup never promotes an expired/tombstoned request to a live Note association; authorization remains Note-owned.

**Conservative record retention:** An UNKNOWN attempt's physical key and minimal durable state are **not deleted or compacted merely because** the SDK timed out, the Note's 24-hour staging window expired, a PostgreSQL lease expired, S3 returned DELETE 204, or a single (or repeated) HEAD returned 404. All these can precede an already-started remote PUT committing later. **If authoritative settlement cannot be established, retain the UNKNOWN locator indefinitely and continue reconciliation/operational monitoring; do not invent a finite retention deadline for V1.** This may grow database metadata and background work. Tombstone compaction (D-23) applies to confirmed terminal attempts only and must never discard the last discoverable locator while a late writer remains possible.

**Logical lifecycle versus physical bytes:** Finalization claims only a verified transfer and atomically associates it in the caller's PostgreSQL transaction, while other attempts remain traceable. Once logical removal/expiry commits, Note routes deny access and any remaining attempt keys are scheduled for cleanup. Physical DELETE is asynchronous and may require repeated inspection. Neither immediate erasure nor a finite orphan-cleanup bound is asserted. A database lease can coordinate workers but **cannot cancel an already-in-flight S3 request**.

**Boundaries delegated to #76/#77:** Exact File API and schema, technically terminal evidence for safe attempt retirement, scheduling/backoff/alerting, lock order and worker lease/fencing details remain story-level design/review tasks **within these invariants**. In particular, do not silently transform indefinite UNKNOWN retention into a timeout-based purge. A future objectively proven settlement/fencing mechanism may justify a separately reviewed finite retirement policy. Real production integration tests must reproduce late PUT versus DELETE, S3 response loss, restart and multi-attempt cleanup. If a provider cannot support this contract, review alternatives explicitly rather than silently substituting it.

### 7.3 Storage acceptance boundary

The POC demonstrated interoperability for pinned SeaweedFS and AWS SDK versions, **not** end-to-end production correctness. The selected recovery direction follows [the POC's UNKNOWN-attempt options](https://github.com/krishna916/horizon/blob/9afce16dde1911f96933f13434b47fac3ce17165/server/poc/s3-compat/results/DECISION-OPTIONS.md), most closely Option 1, while rejecting the assumption that conditional PUT plus a one-time DELETE is sufficient. This document's **acceptance and source-document reconciliation remain explicit separate gates**. #77 owns the production worker and runtime correctness proof.

## 8. Consequences and alternatives

| Choice | Benefit | Cost / tradeoff |
| --- | --- | --- |
| Shared File module and workspace-owned association | Future reuse without leaking Note authorization into storage | Requires disciplined `module.api` boundaries |
| AWS SDK v2 / S3-compatible local+cloud | One transport model, deployment-level provider portability | Self-hosted S3 process and interoperability proof; changing providers does not migrate data |
| Explicit prepare/transfer/finalize | Independent retries, no DB transaction held across S3 upload | More HTTP steps and staged expiry state |
| Client SHA-256 and temporary validation | Deterministic payload identity; reject unsafe bytes before S3 | Browser hashing overhead, bounded local disk/concurrency |
| Central one-time claim | Cross-workspace exclusivity without triggers/polymorphic ownership | Transactional coordination in a modular monolith |
| Durable metadata-backed cleanup | Restart recovery without broker or separate worker service | Recovery protocol and tombstone maintenance |
| Duplicate within-Note image references | Natural editor behavior | Count occurrences on edit/removal and avoid premature deletion |

**Not chosen for V1:** separate filesystem storage backend, File library/folders, cross-note sharing, direct browser S3/presigned uploads, user-selected backend, multipart/resumable transfers, per-user quotas, attachment filename/full-text search, Office conversion/editing, backup/import/export, public/blog sharing or distributed storage. Some are future product opportunities, not implementation tasks now.

**Post-POC disposition:** Stable key + conditional PUT + one DELETE/negative HEAD is **rejected as an insufficient cleanup protocol** by the reported A14/A15 evidence. V1 selects **never-reused per-transfer-attempt keys, committed durable attempt tracking and conservative indefinite retention/reconciliation of UNKNOWN locators** where authoritative settlement cannot be proven (§7.2). The POC's B07 demonstrates feasibility for one late write but not a finite settlement bound. Exact File technical-state DDL, worker lease/fencing, retry cadence and request signatures remain to be reviewed in #76/#77; the POC pins are evidence inputs, not automatic production dependency policy.

## 9. Documentation conflicts and required dispositions

The approved Notes V1 design conflicts with historical sources. This ADR **records** the conflict; it **does not silently amend** those documents or promote itself above the Constitution.

| Source | Conflict | Intended disposition, requiring separate reviewed update |
| --- | --- | --- |
| `PRD-005 Notes` | FR-003 requires a title; old list/side-panel navigation and incomplete file scope | Optional title; file/image-only Notes; Cards/List; direct full-page editor; Notes V1 attachments/inline images |
| `PRD-000 Horizon V1 Scope` | Old general Notes/navigation/file scope | Reflect approved Notes V1 exception without changing Task behavior |
| `PRD-009 Navigation` | Generic List → Side Panel → Full Page for Notes and Tasks | Document Notes direct-full-page exception only |
| `HORIZON_CONSTITUTION` | BIGINT/Long identity norm, knowledge-repository ADR policy, shared module/job assumptions | Record **File UUID-only** exception, lightweight technical lifecycle/recovery, and **File ADR-only GitHub location** exception (D-04/D-24) |
| `PRD-008 Trash` | Must preserve recoverable content | **No scope change**; archive/Trash retain bytes, future confirmed parent permanent deletion invokes cleanup |

Current implementation already supports optional Note title and full-page editing, but source documentation must still be reconciled in its owning locations. **Four section-anchored amendment proposals were approved by the user on 2026-11-22** in the [#75 source-document reconciliation package](../reconciliation/issue-75/README.md): [PRD-005 Notes](../reconciliation/issue-75/PRD-005-Notes-REPLACEMENTS.md), [PRD-000 V1 Scope](../reconciliation/issue-75/PRD-000-V1-Scope-REPLACEMENTS.md), [PRD-009 Navigation](../reconciliation/issue-75/PRD-009-Navigation-REPLACEMENTS.md) and [HORIZON_CONSTITUTION](../reconciliation/issue-75/HORIZON-CONSTITUTION-REPLACEMENTS.md). These are **approved wording proposals but not yet applied authoritative-source edits**, because the PRDs and Constitution live in Horizon's separate knowledge repository and no editable authoritative copy was identified in the connected personal Drive. The reviewed supplied project files match the proposal baseline fingerprints. **No broad migration of ADR authority is implied.** Live source revisions and access must be verified before applying; ADR acceptance and merge remain separate review gates.

## 10. Implementation handoff and acceptance

- **#75:** POC executed and linked; post-POC conservative recovery direction documented in §7.2; review exact ADR acceptance and reconcile authority conflicts through reviewed document changes, and **only then close the gate**.
- **#76:** File metadata, private provider configuration, validated staging/upload, atomic claim API and integration tests.
- **#77:** PostgreSQL-backed durable retry worker, expiry, cleanup, tombstones and proven late-write safety.
- **#78:** Note association, Note-first file upload, secure attachment routes and lifecycle tests.
- **#79:** safe inline-image JSON, atomic insertion, repeated-reference counts and confirmed destructive mutation.
- **#80:** secure attachment preview modal, sanitized Markdown/Mermaid, PDF/image preview and original download.
- **Epic #9:** Global Trash permanent parent deletion via Note/File public APIs (deferred).
- **#74:** Note Search contract deferred to Stage 07; attachment filename/content search not in V1.

### Outstanding acceptance checklist

- [x] D-01–D-29 direction reviewed/approved in conversation and recorded in #75.
- [x] **Draft** ADR stored in GitHub for review; **NOT accepted**.
- [x] Run pinned SeaweedFS/AWS SDK POC and document A01–A16/B01–B13 in [the evidence summary](../validation/ISSUE-75-SEAWEEDFS-S3-POC-REPORT.md) (results reported; test harness available on PR #94).
- [x] Select V1 **per-transfer-attempt keys + durable PostgreSQL tracking + indefinite UNKNOWN retention/reconciliation unless authoritative settlement is proven**; keep actual runtime and worker guarantees for #76/#77 implementation tests.
- [ ] Approve exact minimum File API and invariant-enforcing schema before production stories use them.
- [x] User approved the four **source-document amendment proposals** on 2026-11-22.
- [ ] Verify current authoritative knowledge-source revisions and apply the approved PRD/Constitution updates there (including version/date/changelog). The uploaded source snapshots and GitHub review proposals are not authoritative updates.
- [ ] Review and **accept** ADR; cross-linking/evidence and selected policy recorded, but close #75 only after review of source-document reconciliation and remaining contract gates.

## 11. References

- [#55 — Approved shared File/object-storage handoff](https://github.com/krishna916/horizon/issues/55)
- [#68 — Approved Notes UX direction](https://github.com/krishna916/horizon/issues/68)
- [#75 — Architecture decision register and POC acceptance matrix](https://github.com/krishna916/horizon/issues/75)
- [SeaweedFS POC evidence report](../validation/ISSUE-75-SEAWEEDFS-S3-POC-REPORT.md) — permanent summary, results and unresolved hazards
- [PR #94 — experimental harness, full report and observations](https://github.com/krishna916/horizon/pull/94) — independent branch, not merged
- [#4 — Notes epic](https://github.com/krishna916/horizon/issues/4)
- [#76–#80 — Implementation stories](https://github.com/krishna916/horizon/issues/76)
- [#9 — Global Trash and permanent parent deletion](https://github.com/krishna916/horizon/issues/9)
- [Notes design baseline](../../design/notes-workspace/DESIGN-SPEC.md)
- Existing Notes persistence and command service under `server/src/main/java/com/krishnamurti/horizon/note/`

**Draft only — POC evidence and conservative recovery direction documented; four reconciliation proposals approved for wording. Do not mark this ADR accepted or merge it as final before the actual authoritative source updates and separate ADR acceptance review.**
