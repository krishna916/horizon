# Issue #77 — Durable File recovery and cleanup: design specification

**Date:** 2026-11-27  
**Status:** D77-01–08 and detailed design including R1–R6 approved by human owner on 2026-11-27. Plan authoring authorized; production implementation and repository publication remain subject to plan review.  
**Base reviewed:** `master` at `d2c11bf64b7af1420d840e71b4b90c267cc85654` (merged PR #96).  
**Executor:** Luna, inline and sequential in the normal feature-branch checkout; no worktrees, no subagents or delegation (including review). Open one PR only at the end after all implementation and local CI-equivalent verification; require all actual PR CI checks and SonarCloud quality gate to pass before handoff. No automatic merge.  
**Target repository path after publication authorization:** `docs/superpowers/specs/2026-11-27-issue-77-file-recovery-design.md`.

## 1. Intent and boundaries

Complete the File module's restart-safe PostgreSQL-backed recovery service for incomplete uploads, expired unclaimed reservations, losing physical attempts and committed logical removals. No S3 operation runs in a Note mutation transaction. Never lose the last discoverable locator for a possibly late PUT. Never delete the selected object of a live File. Never equate logical inaccessibility with immediate physical erasure.

Reuse the #76 foundation: `file_metadata`, `file_transfer_attempt`, `FileService`, `FileTransactions`, `FileLifecyclePolicy`, `ObjectStorage`, existing S3 adapter and typed configuration. Preserve the existing Java 25 / Spring Boot 4.0.6 / PostgreSQL 17 / Flyway architecture, provider pins, staging validation, no automatic PUT retries, and existing public DTOs. No new generic job table, broker, Quartz, standalone worker, alternate storage backend, UI, user quota, Task/Journal integration, backup/export or hard-delete UX. Note authorization, associations, versioning and cleanup of stale Note reservations remain Note-owned in #78/#79; actual permanent parent deletion remains Epic #9.

## 2. Source reconciliation and approved decisions

- [#77](https://github.com/krishna916/horizon/issues/77), [#76](https://github.com/krishna916/horizon/issues/76), [merged PR #96](https://github.com/krishna916/horizon/pull/96), [#76 approved specification](https://github.com/krishna916/horizon/blob/master/docs/superpowers/specs/2026-11-25-issue-76-file-foundation-design.md).
- [ADR-010, particularly §7.2](https://github.com/krishna916/horizon/blob/master/docs/architecture/adr/ADR-010-shared-file-object-storage.md), [#75](https://github.com/krishna916/horizon/issues/75), [POC evidence](https://github.com/krishna916/horizon/blob/master/docs/architecture/validation/ISSUE-75-SEAWEEDFS-S3-POC-REPORT.md), [#55](https://github.com/krishna916/horizon/issues/55). Experimental PR #94 is evidence, not code to merge.
- [Constitution](https://github.com/krishna916/horizon-knowledge-store/blob/main/50-AI/ChatGPT%20Context/HORIZON_CONSTITUTION.md), [PRD-000](https://github.com/krishna916/horizon-knowledge-store/blob/main/10-Product/V1/PRD%20000%20Horizon%20V1%20Scope.md), [PRD-004](https://github.com/krishna916/horizon-knowledge-store/blob/main/10-Product/V1/PRD-004%20Tasks.md), [PRD-005](https://github.com/krishna916/horizon-knowledge-store/blob/main/10-Product/V1/PRD-005%20Notes.md), [PRD-008](https://github.com/krishna916/horizon-knowledge-store/blob/main/10-Product/V1/PRD-008%20Trash.md).
- [#68](https://github.com/krishna916/horizon/issues/68), [Notes design](https://github.com/krishna916/horizon/blob/master/docs/design/notes-workspace/DESIGN-SPEC.md), [#78](https://github.com/krishna916/horizon/issues/78), [#79](https://github.com/krishna916/horizon/issues/79), [Epic #9](https://github.com/krishna916/horizon/issues/9).

No product PRD amendment required. Task/Note and Note associations use factual timestamps; File technical state is an explicit Constitution exception. PRD-008's no automatic Trash cleanup is not a prohibition on recovering abandoned object writes. Archive and Trash retain associated bytes; restore preserves File IDs. Only confirmed individual removal (final reference for inline images), unclaimed expiry, losing/failed attempts or future confirmed parent permanent deletion can trigger relevant cleanup. A failed Note save must retain the prior association and bytes. #68 UI is unchanged. D76-07A supersedes only the historical mockup size policy: default 20,971,519 bytes, maximum 104,857,600 bytes inclusive; verified files survive a limit reduction.

The human owner approved D77-01 through D77-08 on 2026-11-27, without changes:

| ID | Approved direction |
|---|---|
| D77-01 | Dedicated in-process Spring Scheduler; reuse existing two File tables as durable queue. |
| D77-02 | Short PostgreSQL transactions, row locking, durable leases and unique fencing tokens. |
| D77-03 | Enabled by default; 30s polling; concurrency 1; up to 25 candidates/cycle; 10m lease; exponential backoff with jitter starting 30s capped at 1h; UNKNOWN successful-delete revisit 1h; unlimited attempts. |
| D77-04 | Option A: conservative UNKNOWN, no worker promotion; client retries using a distinct physical attempt and key. |
| D77-05 | Retain File/attempt UUIDs, idempotency and binding/request fingerprints, lifecycle facts; clear sensitive metadata/locator only after safe terminal cleanup; parent PURGED only after all attempts terminal. |
| D77-06 | Option B: EXPIRED → PURGED; track expiry cleanup internally, distinct from explicit removal. |
| D77-07 | Actuator/Micrometer + bounded safe error codes and runbook, no public retry/force-purge endpoint. |
| D77-08 | Reuse `void requestCleanup(CleanupFileCommand)` with MANDATORY caller transaction; no new bulk API. |

**Approaches considered:** Spring Scheduler with PostgreSQL leases (selected: minimal, durable, existing module boundaries); Quartz (rejected: extra dependency/job persistence); separate worker/broker (rejected: outside V1). For UNKNOWN, conservative cleanup (selected) versus recovery/promotion of uncertain writes (rejected without authoritative evidence). For expiry, preserve EXPIRED until PURGED (selected), versus exposing CLEANUP_REQUESTED for expiry (rejected).

## 3. Invariants and lifecycle

The logical File is not a physical attempt. `file_metadata.selected_attempt_id` is immutable after first eligible verified winner except final parent compaction. Every physical PUT has a distinct UUID-derived key and a committed attempt row before any network transfer. No worker starts PUT, promotes a prior UNKNOWN, or reuses a key. A process crash with `PENDING` is potentially an UNKNOWN write, not evidence of absence. Acknowledged write or conclusively settled rejection recorded by original transfer may establish settlement; timeout, age, matching GET, HEAD 404, lease expiry and DELETE 204 cannot. Preserve #76's acknowledged PUT plus independent length/SHA-256 verification before selection.

### 3.1 Eligibility matrix

| Logical/attempt condition | Worker action |
|---|---|
| Live claimed selected attempt | Never mark cleanup-eligible or delete. Expiry no longer applies. |
| Unexpired unclaimed selected verified attempt | Preserve; caller may finalize. |
| Unexpired logical File with no winner, active PENDING or UNKNOWN | Retain; allow new logical retry attempt when existing API permits. Do not delete potentially selectable PENDING. |
| Attempt has durable cleanup intent from settled failed verification | Process independently; never select it. |
| Another attempt is selected, this attempt is not it | Fence losing attempt permanently, then schedule cleanup, even if parent is claimed. |
| Unclaimed File expires | Record irreversible expiry fact; fence all attempts; no Note query/callback. |
| Explicit cleanup requested | All attempts eligible; logical File inaccessible immediately upon commit. |
| Ineligible PENDING with no settlement fact | Treat conservatively as UNKNOWN; retain locator indefinitely unless original transfer later supplies authoritative settlement. |
| Ineligible settled attempt | Delete, confirm only if settlement was known before this DELETE, compact. |
| Ineligible unsettled attempt | Repeat DELETE/reconciliation indefinitely; never terminally confirm or compact. |
| Parent terminal with no attempts or all attempts confirmed | Compact parent while preserving identity and FK safety. |

For logically live selected File, cleanup of a losing attempt never changes selected pointer, logical descriptor, claim or accessibility. Distinguish attempt-level `cleanup_requested_at` from parent-level explicit removal. For expired File, `EXPIRED` remains the public lifecycle until `PURGED`; if an explicit authorized cleanup request subsequently occurs, existing explicit-removal semantics apply. No new business statuses.

### 3.2 Irreversible cleanup fence and late completions

Under lock order workspace (caller only) → File → attempt, recheck eligibility and durably mark attempt cleanup before any DELETE. Once marked, that attempt cannot be selected, even when original PUT returns success later. Update existing `FileTransactions.recordAttempt` so settlement, selection and cleanup facts are monotonic: a late successful PUT may add verified/settled facts, never clear cleanup intent, never revive a terminal File, never overwrite selected winner or restore a compacted locator. Duplicate/stale completion cannot degrade VERIFIED/settled facts into UNKNOWN or re-mark the winner for deletion. Exact duplicate should be a no-op; contradictory results fail safely with diagnostics. Retain current scope validation.

Expiry fence is also irreversible: use a persisted internal expiry timestamp (`expiry_recorded_at`, proposed name) in addition to existing `expires_at` and check it in prepare/inspect/transfer/claim/recordAttempt/read eligibility. An expiry worker must serialize against claim under the File lock: if claim legitimately wins while eligible, worker preserves it; if expiry commits first, claim fails. Use consistent authoritative time per transaction, preferably PostgreSQL time read after lock acquisition, not transaction-start time for a waited lock. Expiry is effective at `now >= expires_at` as today, even before worker observes it. Once durable expiry is recorded, clock rollback cannot reopen eligibility. No claim of protection from arbitrary clock rollback before any durable expiry observation; operational clock discipline remains necessary. See review refinements R1/R2 below.

## 4. Durable recovery storage and scheduling (reviewable mechanical design)

Extend existing Flyway schema with a new forward migration; do not rewrite #76 migration. Proposed minimum additional fields:

| Table | Fields |
|---|---|
| `file_metadata` | `expiry_recorded_at TIMESTAMPTZ NULL` (internal irreversible expiry fact) |
| `file_transfer_attempt` | `next_cleanup_at TIMESTAMPTZ NULL`, `cleanup_lease_token UUID NULL`, `cleanup_lease_until TIMESTAMPTZ NULL`, `consecutive_cleanup_failures BIGINT NOT NULL DEFAULT 0`, `last_cleanup_error_code VARCHAR(64) NULL` |

Reuse existing `cleanup_attempt_count`, `last_cleanup_attempt_at`, `cleanup_requested_at`, `cleanup_confirmed_at`, `write_settled_at`, `outcome` and locator. No separate queue table or new user-facing state. Null lease fields paired; no lease/schedule on compacted attempts; nonnegative counters; confirmed cleanup requires settled write, durable cleanup intent and safe acknowledgement. Existing #76 composite selected-attempt FK and restrictive FKs remain. Add bounded indexed discovery for unclaimed expiry, newly eligible losing/failed attempts, due or expired-lease cleanup and terminal parent compaction; ensure existing #76 rows with cleanup intent but no next date are discoverable immediately. Use deterministic ordering by due timestamp + UUID; avoid offset pagination or unbounded load. Validate actual migration/index query plans in PostgreSQL tests. Existing attempt outcome enum is retained.

Use `FileProperties` nested recovery configuration and application YAML/env conventions. Approved default values are D77-03. Validate positive intervals and batch size; cap jittered backoff at max; lease must exceed the configured upper bound of a single remote DELETE plus completion margin (default S3 operation timeout 5m, lease 10m). Proposed equal-jitter retry: compute `min(1h, 30s * 2^(consecutiveFailures-1))` safely with saturation; actual delay uniformly from half to full capped value. Reset consecutive failures after successful acknowledgement, not cumulative attempt count. Use injected/testable clock and jitter source. UNKNOWN after successful DELETE becomes due 1h later; no retry limit or retention TTL. A successful deletion on a settled attempt is terminal, not rescheduled. A newly recorded settlement on a previously unsettled attempt makes it immediately eligible for a fresh deletion after any active lease releases.

Dedicated managed scheduler with fixed delay, no overlap in one JVM. Claim one item at a time immediately before I/O, not all 25 leases upfront. Count at most 25 work items per cycle; expire/mark logical rows and process due attempts without starvation using bounded fair interleaving. A slow cycle may take longer than 30s; delay is between cycles, not a cleanup latency guarantee. Disabled worker leaves durable intents intact for later resume; production default enabled. Multiple application processes can compete safely through DB locks even though deployment remains single-machine.

## 5. Processing protocol

1. **Short DB transaction — eligibility and claim:** identify a bounded candidate, acquire File row then attempt row; recheck immutable selection/expiry/cleanup eligibility, due time and lease expiry. Persist fence, fresh random lease token, lease deadline, attempt count and last attempt time. Capture immutable key and whether `write_settled_at` was already present. Return only after commit. Do not block other candidates on remote I/O. Stale candidate is skipped. Never claim a selected live object.
2. **No DB transaction — remote operation:** call existing `ObjectStorage.delete(ObjectKey)`. For ineligible UNKNOWN, periodic idempotent DELETE is reconciliation; HEAD is optional diagnostic evidence only, not required as a precondition or settlement. No GET-based promotion. Treat storage exceptions as retryable; do not retain raw provider payloads in DB or logs. Bound by existing operation timeout.
3. **Short DB transaction — completion:** acquire File then attempt; require matching lease token and unexpired lease. Stale or expired completion is ignored and later work remains recoverable. On failure, persist safe error category, failure count and next due time. On ACK when write was settled *before* this request and current row remains eligible, record cleanup confirmation, clear scheduling/lease and compact attempt. On ACK when write was not settled at claim, retain locator, clear lease and schedule another pass (immediately if now settled, otherwise 1h). Never retroactively credit that DELETE as post-settlement proof. Check current time and state under lock. No DB lock held across network. Crash before completion simply leaves leased work recoverable; repeated DELETE is safe for permanently fenced keys.
4. **Parent terminal compaction:** under File lock, verify permanent inaccessibility (explicit cleanup or durable expiry) and every attempt safely confirmed/compacted, or no attempt ever registered. Clear descriptor, selected pointer and set `purged_at` atomically; never delete identity rows. A parent with unresolved UNKNOWN remains non-PURGED indefinitely. If selected attempt is already compacted while another attempt remains unresolved, preserve selected FK pointer until parent purge (existing SQL claimed constraint requires it); parent must already be inaccessible. Preserve idempotency, scope and request fingerprints; never restore sensitive fields from retries.

**Safety argument:** all possible remote DELETE targets are permanently barred from becoming live before the first DELETE. Tokens prevent stale database completions but cannot fence S3; therefore an old DELETE is still safe because its key cannot ever become live again. All possible late writers retain unique durable locators until settlement plus later confirmed deletion. Losing attempts can never overwrite the selected object's distinct key. No cross-resource ACID or finite UNKNOWN recovery bound is claimed.

**Provider contract refinement:** terminal physical cleanup requires an unversioned/non-retaining private bucket (or separately proven equivalent delete semantics), not merely a delete marker in a versioned bucket or an object-lock retention policy. Existing `DeleteResult.ACKNOWLEDGED` confirms provider acknowledgement, not a previous ambiguous PUT. For V1 propose documenting and verifying non-retaining bucket configuration in provider/deployment checks; if versioning/retention cannot be excluded, stop for review rather than silently claiming erasure or implementing version enumeration. Do not silently change existing provider pins or IAM. See R5.

## 6. Module API and ownership

Keep `FileService.requestCleanup(CleanupFileCommand)` and current public DTO signatures. `requestCleanup` and claim/prepare remain MANDATORY; transfer and openRead remain NEVER on outer orchestration. Scope remains trusted caller-supplied user/workspace/binding fingerprint; UUID/key alone never authorizes. Caller must prove association/parent authorization before invoking. Explicit logical cleanup is atomic with caller-owned association/document/version changes, with no S3 calls. Repeated cleanup is safe; rollback cancels intent. Inspect authorized tombstones without sensitive metadata after purge. No new File HTTP endpoint; future parent permanent deletion calls existing operation for each authorized association within caller transaction, with consistent File ID ordering for multiple locks. Already-admitted read streams may complete under #76 contract; new admissions after removal commit denied.

## 7. Observability and operator runbook

Use existing Actuator/Micrometer pattern and access controls. Proposed measures: pending/due/overdue recovery work; unresolved UNKNOWN/PENDING backlog and oldest age; cleanup attempts and confirmed terminal deletes; retryable failures by bounded error category; lease reclaim/stale completion counters; worker cycle duration and last successful poll. Distinguish successful reconciliation DELETE from terminal cleanup. No metrics tagged with file/user IDs, object keys, filenames, checksums, raw exception text or credentials. Keep latest safe error code (e.g. STORAGE_UNAVAILABLE, DELETE_FAILED, DB_RETRY) and retry time; no unbounded error history. Runbook: verify scheduler enabled, DB and private bucket health; inspect aggregated backlog and oldest age, lease deadlines and retry time via authorized operations; correct configuration/credentials/outage, allow automatic retry; never force-purge unknown locators or manually mutate associations. No new public exposure, dashboard, manual force purge or user-facing quotas. Explain potentially growing UNKNOWN metadata/workload and lack of finite cleanup bound.

## 8. Production verification and acceptance mapping

Use existing real PostgreSQL and pinned SeaweedFS Testcontainers, `S3FaultHarness`, `RecordingObjectStorage`, `TestFileOwner`, and restart integration infrastructure. Unit tests supplement real worker tests; fake storage alone is insufficient for A12/A14/A15/B07/B08. Use deterministic latches/proxy barriers and controlled time/lease changes, not sleep-based luck. For late PUT tests prove late object actually appears after earlier DELETE, then later worker removes it while retaining UNKNOWN locator. Negative test must fail on naive one-shot DELETE or early locator purge.

| Evidence / acceptance | Production tests |
|---|---|
| A11–A15, B01–B02, B07 | Interrupted/lost-response PUT, post-PUT DB rollback/crash, late PUT after DELETE including conditional hazard as applicable; restart same DB, no locator loss, eventual removal; UNKNOWN persists after repeated negative HEAD/ACK. |
| B03–B06, B09–B10 | Same logical retry/new key, incompatible scope conflict, first eligible winner, expiry/claim race, late original completion cannot select fenced attempt, tombstone non-resurrection. Existing verified staged bytes survive caller conflict; lost finalize retry contract using test-only owner. |
| B08 | Committed caller removal immediately denies new reads, rollback preserves state; S3 outage and repeated delete, restart after lease/remote ACK before DB completion, eventual settled terminal compaction. |
| Worker fencing | Two workers compete, one valid lease; stale token/expired completion cannot overwrite new results; no DELETE while attempt still selectable; late settlement forces fresh post-settlement DELETE. |
| Compaction | No-attempt expiry; multi-attempt parent with live winner and losing cleanup; expired/removed parent with UNKNOWN retains locator and descriptor until terminal; only compact safe attempts; preserve FK/idempotency and reject late reactivation. |
| Scheduling | Validated defaults/overrides, no tight retry loop, capped jitter, unlimited retries, one-hour UNKNOWN revisit, fair bounded batch, restart and no overlapping local poll. |
| Privacy and module boundary | Wrong user/binding rejected; no Note repositories/callback; no S3 within caller tx; no raw keys or sensitive metadata in diagnostics. |
| Consumer contract | Test-owner surrogate shows association/version+cleanup commit/rollback and multiple authorized removals; claimed files survive archive/Trash-equivalent caller operations with no cleanup invocation. Actual Note route/UI/duplicate-inline-reference/Trash tests remain #78/#79/Epic #9. |

Run `cd server && ./mvnw test && ./mvnw verify` and targeted real-provider/fault tests; no Docker-dependent silent skips. Report exact commands, tests, failures, provider pins and limitations. Do not claim runtime correctness before evidence. No production code executed or modified by this design review.

## 9. Approved review refinements (R1–R6)

These make D77-01–08 concrete; the human owner explicitly approved them with this detailed design:

- **R1:** Persist `expiry_recorded_at` and keep the public EXPIRED lifecycle; use coherent DB time for worker/eligibility decisions and never un-fence a recorded expiry.
- **R2:** Permanently fence attempts before DELETE; monotonic original transfer completion, and only count DELETE initiated after recorded settlement as terminal evidence. Keep current #76 conservative no-promotion behavior.
- **R3:** Exact proposed fields/constraints and one-at-a-time lease acquisition, fair bounded fixed-delay polling; do not lease entire batch in advance. Reuse current public API.
- **R4:** Equal jitter (half-to-full capped exponential delay), separate cumulative and consecutive failure counts, immediate fresh DELETE after late settlement, one-hour repeat ACK for unsettled UNKNOWN; direct idempotent DELETE is reconciliation without mandatory HEAD.
- **R5:** Explicit non-retaining private-bucket deployment prerequisite and verification of compatible deletion semantics; no new versioned-object purge mechanism. Stop if current provider contract cannot support it.
- **R6:** Diagnostic dimensions and no-attempt/mixed-attempt compaction behavior in sections 5–7; use existing restricted operations surfaces.

**Review gate:** D77-01–08 and R1–R6 approved. Review the accompanying implementation plan before publication or execution; no PRDs, GitHub issues, branches or application code changed during design/plan authoring. Historical proposal wording in the body is retained as the approved design record, not an invitation to reopen decisions.
