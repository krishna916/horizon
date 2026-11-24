# #76 — Shared File foundation: implementation specification

| Status | Version | Date |
|---|---|---|
| Approved design decisions; consolidated specification awaiting review | 1.0 | 2026-11-25 |

| Field | Value |
|---|---|
| Story | [#76](https://github.com/krishna916/horizon/issues/76) |
| Epic | [#4 — Notes workspace](https://github.com/krishna916/horizon/issues/4) (epic blueprint and child sequence) |
| Owner | Horizon Engineering |
| Architecture | [#55](https://github.com/krishna916/horizon/issues/55), [ADR-010](https://github.com/krishna916/horizon/blob/master/docs/architecture/adr/ADR-010-shared-file-object-storage.md), [#75 POC report](https://github.com/krishna916/horizon/blob/master/docs/architecture/validation/ISSUE-75-SEAWEEDFS-S3-POC-REPORT.md) |
| Product | PRD-000, PRD-005 Notes, PRD-008 Trash, PRD-009 Navigation, SPEC-001, Constitution (authoritative knowledge store) |
| UX | [#68](https://github.com/krishna916/horizon/issues/68), [approved design baseline](https://github.com/krishna916/horizon/tree/master/docs/design/notes-workspace), merged PR #82 |
| Engineering | server/AGENTS.md, docs/ai/ENG-001 Engineering Guidelines v1.0.md, Horizon Implementation Workflow |
| Future consumers | #77 recovery, #78 Note attachments, #79 inline images, #80 previews |

## 1. Context and objective

Provide the provider-independent, private shared File foundation: a logical UUID identity, bounded validated transfer, durable physical-attempt tracking, atomic caller-owned claim, streaming read and durable cleanup request. Use real PostgreSQL and a private S3-compatible deployment. The approved architecture gate #75 is complete (ADR PR #93, knowledge-store PR #1); the experimental POC PR #94 is not production code. A12/A14/A15 prove lost responses and late PUT hazards; B07 does not prove finite safe retirement. Do not merge the experimental branch.

The user approved the scope split and decisions D76-01–10 including D76-07A in conversation. This specification consolidates them; the accompanying plan is a reviewable handoff, not a claim of implementation or test success. Read the linked sources and current repository before editing. Epic #4 is the shared blueprint; no new duplicative epic document is required. No Task status change: the technical transfer enum is the narrow File lifecycle exception, not a business status.

## 2. Functional scope and rules

- #76: File-owned metadata and attempt tables, public Java API and upload policy, internal storage port, S3 implementation, validation/staging, short transactions, durable intent and test-only caller, Compose, metrics and tests. No production Note changes or HTTP endpoints.
- #77: actual scheduled recovery/cleanup, backoff, lease/fencing, terminal compaction and operations runbook. #76 persists enough facts and tests recovery invariants, not a completed recovery service.
- #78: Note-owned reservation/association, authorization, version mutation, first-file Note creation, backend routes, effective upload policy exposure, per-file UI progress/retry, archive/trash tests. #79 images, #80 previews. No Task/Journal integration, public or presigned URLs, Files workspace, quota, broker, alternative production provider, filesystem backend, multipart/resumable transfer, multi-machine support, deduplication or data migration framework.
- #68 remains authoritative: full-page editor, optional title, untouched/tag-only draft creates nothing, first file/image persists Note with staged tags before transfer, failed first upload keeps Note, independent Retry, confirmed removal after successful save, Archive and Trash retain bytes, file modal not Note side panel. These are future consumer constraints, not #76 UI deliverables. Historical #68 mockups say under 20 MB; approved D76-07A supersedes only that limit, not design/layout. #73 deferred actual-file lifecycle checks remain #78.

## 3. Approved decision register

| ID | Binding implementation decision |
|---|---|
| D76-01 | Two File-owned relational tables; logical File and individual physical attempt. |
| D76-02 | Logical facts/timestamps; technical attempt outcome enum; independent cleanup/settlement facts. |
| D76-03 | Globally unique upload idempotency UUID, opaque scope fingerprint, no Note ID/role in File; owner module authorizes. |
| D76-04 | Caller MANDATORY prepare/claim/cleanup; transfer NEVER; pre-PUT and post-PUT committed short transactions; workspace → File → attempt lock order; first eligible verified committed winner; no automatic PUT retry. |
| D76-05 | Full pre-PUT bounded disk staging, four concurrent operations, 64 KiB copy buffer, dedicated staging, crash cleanup; independent GET + SHA-256. |
| D76-06 | Public Java interface, internal ObjectStorage port, one S3 adapter, constructor injection, provider contract tests. |
| D76-07 | Approved dependency pins, format strategies and parser limits/policies (§6); centralized Maven versions, no Tika/AV or separate parser service initially. |
| D76-07A | Default max 20,971,519 B, deployment-configurable, hard inclusive ceiling 104,857,600 B; no retroactive invalidation. |
| D76-08 | API below, versioned length-prefixed UTF-8 fingerprints, provider-free DTOs, closeable reads and discovery of effective policy. |
| D76-09 | Schema below, composite selected-attempt FK, string enum + checks, UUIDs, explicit identifier mappings, no triggers/cascade, minimal tombstones. |
| D76-10 | Real PG/SeaweedFS, Toxiproxy, existing Maven gates, typed configuration, derived staging budget, bounded timeouts, private Compose, health/metrics. |

## 4. Source reconciliation — blocking preflight before production work

Approved D76-07A changes D-02 only; preserve D-26/27/29 and all other decisions. Prepare reviewable source amendments (do not silently alter historical evidence or merge without the normal approval process). Verify live paths in each repo; use the existing knowledge-store ownership rather than relocating PRDs to code repo.

| Source | Exact amendment intent |
|---|---|
| ADR-010 D-02 and §6.2 paragraph beginning “Reject unknown-length streams” | “Each binary must have a known positive length no greater than the effective deployment limit. Default 20,971,519 bytes (strictly less than 20 MiB); configurable up to and including 104,857,600 bytes (100 MiB). Reject length absence/mismatch, above-effective-limit new/unverified transfer, and SHA-256 mismatch before PUT. Previously verified files remain valid after reducing the limit. No aggregate quota.” Preserve all staging/recovery rules. |
| PRD-005 §9 file Size/type paragraph (locate exact heading in live version) | Replace fixed boundary with default 20,971,519 bytes and deployment-configurable inclusive ceiling 100 MiB; retain allowlist, known length, checksum and validation. Notes surfaces effective policy from backend in #78. |
| PRD-000 Notes scope | Replace fixed limit with ADR-owned deployment-configurable per-file limit (default strictly under 20 MiB, maximum 100 MiB). No new workspace or quota. |
| #76 original scope and required acceptance criteria | Replace fixed under-20-MB rule with D76-07A; add boundary/config tests; append approved D76 register/links when artifacts published. |
| #78, #79, #80 and Epic #4 | Scan for fixed limits; document effective policy discovery/enforcement in #78, inherited by later consumers. No UI change in #76. |
| #68 design | Keep historical approved prototype/evidence; add trace note to story handoff that limit superseded by D76-07A; do not redesign. |

Search authoritative sources for `20 MiB`, `20 MB`, `20MB`, `20,971,519`, `20,971,520`, `20971519`, `20971520`; inspect context before editing. Constitution/PRD-009/PRD-008 are not rewritten absent a conflict. Report exact diffs and approval/merge status. If source amendment cannot be made, stop before production coding and report blocker. A draft in this file is not a merged source amendment.

## 5. API design (no HTTP)

Base package `com.krishnamurti.horizon.file`. Public interfaces `api.FileService` and `api.FileCapabilities`; DTOs in `api.command`, `api.query`, `api.model`. Public API must contain no S3, persistence, Spring MVC or servlet types. Use UUIDs, Long user IDs, `Instant`, `InputStream`, immutable Java records. Conceptual public signature list approved D76-08:

```java
interface FileService {
    FileSnapshot prepare(PrepareFileCommand command);
    TransferResult transfer(TransferFileCommand command);
    FileSnapshot inspect(InspectFileQuery query);
    ClaimResult claim(ClaimFileCommand command);
    FileContent openRead(ReadFileQuery query);
    void requestCleanup(CleanupFileCommand command);
}
interface FileCapabilities { FileUploadPolicy getUploadPolicy(); }
record FileScope(Long userId, String workspace, String bindingFingerprint) {}
record FileReference(UUID fileId, FileScope scope) {}
record FileDescriptor(String originalFilename, String declaredContentType,
                      long expectedSize, String expectedSha256) {}
record FileUploadPolicy(long maxFileSizeBytes, Set<FileFormat> supportedFormats) {}
record PrepareFileCommand(UUID idempotencyKey, FileScope scope, FileDescriptor descriptor) {}
record TransferFileCommand(FileReference file, long contentLength, InputStream content) {}
record InspectFileQuery(FileReference file) {}
record ClaimFileCommand(FileReference file) {}
record ReadFileQuery(FileReference file) {}
record CleanupFileCommand(FileReference file) {}
record FileSnapshot(UUID fileId, FileLifecycle lifecycle, FileMetadata metadata,
                    Instant createdAt, Instant expiresAt, Instant claimedAt,
                    Instant cleanupRequestedAt) {}
enum FileLifecycle { PREPARED, VERIFIED, CLAIMED, EXPIRED, CLEANUP_REQUESTED, PURGED }
enum TransferDisposition { VERIFIED, ALREADY_VERIFIED, RETRYABLE_FAILURE, OUTCOME_UNKNOWN }
enum ClaimResult { CLAIMED, ALREADY_CLAIMED }
```

**Mechanical completions for review, not independently approved signatures:** `FileMetadata(String originalFilename, String declaredContentType, FileFormat validatedFormat, long sizeBytes, String sha256)`; `TransferResult(TransferDisposition disposition, FileSnapshot file)`; `FileContent(FileMetadata metadata, InputStream stream) implements AutoCloseable` closes the provider stream; `FileFormat` values JPEG, PNG, WEBP, GIF, PDF, DOCX, XLSX, PPTX, TXT, MD, CSV, MERMAID (JPG and MMD are aliases). Use nullable validatedFormat until verified and absent metadata for purged snapshot; do not expose physical locators. These names/types fill previously unshown fields; review them with this handoff, not silently change the approved interface. No HTTP status code decisions in #76.

| Operation | Transaction | Semantics |
|---|---|---|
| prepare | MANDATORY | Authorized caller creates reservation in same transaction in #78; identical globally unique idempotency key returns existing identity/current terminal outcome; mismatched owner/binding/metadata generic conflict; check current limit for new reservation, not historical identical replay. Concurrent insert uses atomic conflict-safe insert then compare, not catch a poisoned transaction. |
| transfer | NEVER | Scope and lifecycle checked, declared length must match; existing eligible verified result returned without new PUT; no stream retained or closed by File (caller owns input). For new/unverified transfer enforce current limit. Stage fully, register attempt committed, PUT and independent GET outside tx, record outcome committed. |
| inspect | short read-only | Scope checked, derived lifecycle; no S3 I/O. |
| claim | MANDATORY | Lock File and conditional single claim if verified, selected, unexpired and no cleanup; same PG tx as caller association/version. ALREADY_CLAIMED never authorizes another association; caller verifies existing finalized association in #78. |
| openRead | NEVER for outer orchestration | Short DB eligibility snapshot, no S3 I/O in transaction. Only claimed, no cleanup, verified selected attempt, matching trusted scope. Caller closes returned content; no new reads admitted after committed removal; already-admitted stream may complete. |
| requestCleanup | MANDATORY | Idempotent durable logical inaccessibility; no synchronous DELETE; caller detach/version same tx in #78. |
| getUploadPolicy | no DB | Immutable effective max bytes and format allowlist. No exposure of provider settings. |

Scope is trusted caller input (workspace controlled by server code, not browser, path-safe), validated on every operation. Wrong user/binding → generic not found; cross-user prepare collision → generic conflict, no metadata leakage. Never authorize by UUID/key. Caller must prove Note ownership/association and authorization before invoking. Semantic failures follow existing exception conventions: invalid metadata/length/checksum, too large, unsupported/unsafe, conflict, not found, retryable capacity/provider, unknown PUT result. No raw SDK errors. Expired/removed mutations conflict; read not found; inspect may show authorized terminal outcome. Proposed lifecycle precedence: PURGED > CLEANUP_REQUESTED > CLAIMED > EXPIRED (unclaimed, now >= expires_at) > VERIFIED > PREPARED. Ineligible late result stays inaccessible; no new claim or reactivation.

Fingerprint v1: SHA-256 of versioned length-prefixed UTF-8 fields in order user ID canonical decimal, workspace, caller binding hash, original filename, declared content type, expected size canonical decimal, client SHA-256 lowercase hex. Caller owns opaque binding hash (Note ID + role + version in #78); File never hashes Note-specific data itself. Mechanical encoding proposal for review: first field literal `1`, each UTF-8 byte sequence preceded by unsigned 4-byte big-endian byte length; no delimiters, no platform charset, no unapproved normalization except lowercase hex. Publish fixed vectors; retain version and compare using stored algorithm. Validate descriptor on prepare and avoid path/header injection; filename is metadata, never path. Exact allowed MIME aliases/normalization, empty file policy (approved positive size), filename handling and error class names must be reviewed if source conventions disagree; no broadening allowlist.

## 6. Validation and staging

Strict known positive size (<= effective limit), exact observed length and SHA-256 (read at most limit/declared size + one detection byte, no excess persisted), client content type/extension consistent with detected actual format, no S3 or durable attempt registration before full validation. Reject absent length at caller boundary; no multipart buffering assumptions. Stage in dedicated configurable local directory, generated temp names, restricted permissions, no symlink traversal, exclusive process lock for directory; only own artifacts cleaned on startup, fail if ownership/lock cannot be secured. Four concurrent slots, 64 KiB buffer, payload capacity default max bytes × slots (83,886,076 B at default), optional override, reserve capacity before staging, fail fast on exhaustion/disk full, release in finally even if parsing/DB/remote fails. Count abandoned files and scratch, clean verified safe startup artifacts, no durable filesystem backend. No full file byte arrays. Stage through verification and release after all exit paths.

| Family | Validator and policies |
|---|---|
| JPEG/JPG, PNG, GIF, WebP | Java ImageIO + TwelveMonkeys WebP 3.15.3; signatures and actual structural validation; dimensions <=8192 each, canvas <=16,000,000 pixels (megapixel unit clarification for review), <=100 frames, <=64,000,000 cumulative decoded pixels; check before allocating, decode bounded frames sequentially, reject truncation/spoofing. Real static/animated WebP fixtures mandatory; stop if reader cannot meet contract. |
| PDF | PDFBox 3.0.8 strict structural parse, <=1000 pages, reject malformed repair, inaccessible encrypted content, JavaScript/launch/embedded files. No render or external resolution; bound scratch; reject if cannot prove policy. |
| DOCX/XLSX/PPTX | POI 6.0.0 OPC/package validation, expected root part/content type, <=2048 entries, <=32 MiB expanded each, <=128 MiB expanded total, compression-ratio guard, reject duplicate/unsafe paths, macros/executable embedded objects, encrypted uninspectable files; no external fetch, no XXE; inert ordinary hyperlinks allowed. Validate actual expanded byte counts; do not trust ZIP header sizes. |
| TXT/MD/CSV/MMD/MERMAID | Strict streaming UTF-8 decoder (REPORT), BOM allowed, reject binary/invalid encoding, standalone HTML/SVG/executable spoof; Markdown HTML snippets as inert text allowed, sanitization #80. |

Each parser scratch allowance <=128 MiB per validation, independent of payload. Parser resource limits configurable, must remain bounded; prove memory/disk/CPU behaviour with adversarial fixtures; no claim of comprehensive malware detection or guaranteed in-process sandbox. If approved libraries cannot enforce bounds or format policy, stop and request review rather than accept unsafe content, silently exclude a format, invent a numeric threshold, or add a service/dependency. `FileValidator.supports(FileFormat)` and `validate(StagedFile): ValidationResult` internal strategy; `FileValidationService` dispatch. Approved defaults above; exact compression ratio, allowed MIME aliases, detection of standalone markup vs Markdown snippets, parser CPU/heap budgets and timeout enforcement require review if not fixed by approved library defaults/actual tests. No arbitrary security-policy changes.

## 7. Technical design and storage

`application.DefaultFileService` orchestrates; separate Spring transactional component(s) to avoid self-invocation. Internal `application.port.ObjectStorage` defines put/head/get/delete using provider-neutral request/result/stream types. Proposed internal signatures:

```java
interface ObjectStorage {
    WriteResult put(ObjectWriteRequest request);
    ObjectMetadata head(ObjectKey key);
    StoredObject get(ObjectKey key);
    DeleteResult delete(ObjectKey key);
}
```

Internal type contract: ObjectKey opaque immutable string; ObjectWriteRequest carries key, staged path, known length and validated content type; WriteResult distinguishes acknowledged success, conclusively failed (settled), uncertain; ObjectMetadata distinguishes found with size, missing, and errors; StoredObject owns closeable stream plus length; DeleteResult distinguishes acknowledged delete/absence from error and never implies prior write settlement. Exact internal fields/types are mechanical proposals to review, never exposed via public API. Adapter `infrastructure.storage.s3.S3ObjectStorage` and `S3Configuration`; SDK-specific types and errors isolated there. Provider contract reusable against future adapters; one deployment-wide provider/bucket, no registry.

Transfer algorithm:

1. Check reference/scope and eligibility in short transaction; existing verified eligible object can return replay result. Stage/validate outside transaction. Recheck eligibility under File row lock after staging before registering.
2. Generate attempt UUID; physical key `users/{userId}/{workspace}/{attemptUuid}` (no filename), never reused. Insert PENDING attempt with expected bytes/digest and locator; commit before any PUT. If commit fails, no PUT. Repeated explicit transfer gets a different attempt UUID; no hidden retries, redirects or replay paths that could issue another PUT to same key; verify network count. No DB lock across external I/O.
3. One known-length PUT; independent streaming GET of selected physical key candidate, count exact bytes and digest; HEAD alone/ETag/PUT response alone insufficient. Only verified candidate can be selected; if acknowledgement lost or response ambiguous, retain UNKNOWN even if GET absent or matching bytes (conservative foundation; #77 decides authoritative reconciliation). A successful acknowledged PUT plus independent verified bytes qualifies for selection. Acknowledged success can establish settled write for the one attempt; failed verification still inaccessible and track cleanup; ambiguous failure never FAILED. Preserve successful/failed write settlement separately from transfer outcome; do not infer settlement from a read/delete/timeout. Crash leaving PENDING = potentially UNKNOWN.
4. Record facts in new short transaction under File → attempt lock. First eligible verified commit wins; never replace selected attempt. On expired/removed File or already selected other attempt, record outcome/cleanup eligibility, preserve locator; no promotion. If post-PUT DB commit fails, pre-PUT locator survives. #77 owns scheduled worker and recovery of UNKNOWN/PENDING and losing attempts. No finite UNKNOWN deadline.
5. Claim uses a conditional mutation with row lock in caller's transaction; no S3 I/O. Cleanup request is logical only and durable in same caller tx. Reads admit only claimed eligible snapshot; storage I/O outside tx. Lock order workspace → File → attempt (File never locks workspace). Multi-row operations consistent ordering to avoid deadlocks; stop/review if needed beyond approved scope.

## 8. Database design

Flyway SQL only, Hibernate validate, application UUID not existing BIGINT BaseEntity, explicit ID fields, `Instant`/TIMESTAMPTZ, no JPA cascade or triggers. `file_metadata` (all NOT NULL unless `?`):

```
id UUID PK, user_id BIGINT FK users(id) RESTRICT,
workspace VARCHAR(64), idempotency_key UUID UNIQUE,
binding_fingerprint VARCHAR(64), request_fingerprint VARCHAR(64), fingerprint_version SMALLINT,
original_filename VARCHAR(255)?, declared_content_type VARCHAR(255)?, validated_format VARCHAR(32)?,
expected_size_bytes BIGINT?, expected_sha256 VARCHAR(64)?, selected_attempt_id UUID?,
created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, claimed_at TIMESTAMPTZ?,
cleanup_requested_at TIMESTAMPTZ?, purged_at TIMESTAMPTZ?, updated_at TIMESTAMPTZ
```

`file_transfer_attempt`:

```
id UUID PK, file_id UUID FK file_metadata(id) RESTRICT,
object_key VARCHAR(512)? UNIQUE, expected_size_bytes BIGINT?, expected_sha256 VARCHAR(64)?,
outcome VARCHAR(32), verified_size_bytes BIGINT?, verified_sha256 VARCHAR(64)?,
created_at TIMESTAMPTZ, verified_at TIMESTAMPTZ?, write_settled_at TIMESTAMPTZ?,
cleanup_requested_at TIMESTAMPTZ?, last_cleanup_attempt_at TIMESTAMPTZ?,
cleanup_attempt_count BIGINT NOT NULL DEFAULT 0,
cleanup_confirmed_at TIMESTAMPTZ?, updated_at TIMESTAMPTZ,
UNIQUE(file_id,id)
```

Add composite FK `(id, selected_attempt_id) REFERENCES file_transfer_attempt(file_id,id)` after both tables. Restrictive FKs, nullable selected pointer during preparation. CHECK canonical 64 lowercase hex for fingerprints/digests when present, positive byte sizes <=104857600 (not operational limit), `outcome IN ('PENDING','UNKNOWN','VERIFIED','FAILED')`, nonnegative cleanup count, expiry > creation, timestamps consistent with creation; selected pointer/validated format required for active claimed File, active descriptor fields required, purged sensitive fields and selected locator pointer cleared. VERIFIED attempt must have matching expected/verified digest and length while active; FAILED only settled; locator and expected identity must remain while unsettled or cleanup unconfirmed. Cleanup confirmation requires write_settled_at and must not precede it. Cross-row verified/eligible selection and complete purging are enforced by transactional logic, not triggers; #77 compaction must preserve FK-safe minimal identity/tombstones, UUIDs and fingerprint, never discard locator while any unsettled remote write possible. Unique attempt UUID remains after compaction; key derived from UUID prevents reuse. Actual compaction not implemented in #76. Clarify verified-but-unsettled observation vs selected eligible per recovery algorithm; conservative no promotion on unknown result until separately approved recovery evidence.

Indexes: unique idempotency; user_id; partial expiry on unclaimed/no cleanup/no purge; partial cleanup_requested_at on pending cleanup; unique(file_id,id); unique object_key where non-null (single unique constraint/index sufficient); partial created_at on unresolved PENDING/UNKNOWN. No speculative indexes or #77 retry/lease fields. Migration uses next free timestamp after existing live migrations; suggested filename in plan is reviewable mechanical naming. Test SQL CHECK null semantics explicitly; no nullable-column CHECK loophole. Account deletion RESTRICT; future workflow must coordinate recovery, not cascade-delete.

## 9. Dependencies and deployment

Java 25, Spring Boot 4.0.6, PG17, managed Spring Data/Flyway/Testcontainers. Central Maven AWS BOM 2.59.2 (`s3`, synchronous HTTP client as necessary), `com.twelvemonkeys.imageio:imageio-webp:3.15.3`, `org.apache.pdfbox:pdfbox:3.0.8`, `org.apache.poi:poi-ooxml:6.0.0`. Published artifact evidence: https://central.sonatype.com/artifact/org.apache.poi/poi-ooxml/6.0.0 ; https://central.sonatype.com/artifact/org.apache.pdfbox/pdfbox/3.0.8 ; https://central.sonatype.com/artifact/com.twelvemonkeys.imageio/imageio-webp . Use existing managed Testcontainers version; verify dependency tree, direct/transitive vulnerabilities, Java25/Boot compatibility. No silent substitution if failure. Test-only Toxiproxy 2.13.0 image `ghcr.io/shopify/toxiproxy:2.13.0@sha256:5d3dae09bc185dcc5ff6cf43abf6062a4a720aff0c4306a471e773acdcd107aa`. SeaweedFS `ghcr.io/chrislusf/seaweedfs:4.54@sha256:e7d4b80af9bd49b2630a60ac6fbb7ffb620ac6a2c501f689c22a71b9f89f0203` (linux/amd64 child; ARM64 requires separately verified pin). POC harness stays unmerged. Use the approved provider's verified settings from #75, not invented command flags.

```yaml
horizon:
  file:
    max-file-size: ${HORIZON_FILE_MAX_FILE_SIZE:20971519B}
    unclaimed-expiry: 24h
    staging:
      directory: ${HORIZON_FILE_STAGING_DIRECTORY:./data/file-staging}
      max-concurrent-transfers: 4
      copy-buffer-size: 64KB
      # max-total-size optional; defaults to effective max bytes * slots
    storage:
      s3:
        endpoint: ${HORIZON_S3_ENDPOINT:}
        region: ${HORIZON_S3_REGION:us-east-1}
        bucket: ${HORIZON_S3_BUCKET}
        path-style-access: false
        connection-timeout: 5s
        socket-timeout: 30s
        operation-timeout: 5m
        read-max-attempts: 3
```

Use DataSize validation and explicit env placeholders (relaxed binding alone does not imply underscore-separated hyphens). Fail invalid/missing required config at startup, positive bounds and overflow-safe derived budgets, deployment restart to change values. Parser limits above also configurable via typed properties. Separate scratch and payload accounting, no hidden 20 MiB fixed check; current limit on new/unverified transfers, existing verified bytes not invalidated, expiry captured at prepare (24h default). Local Compose extends `server/compose.yaml` PostgreSQL unchanged, persistent SeaweedFS volume, loopback-bound S3 service, idempotent authenticated bucket bootstrap (`horizon-files` local), path-style local true, authenticated health, no public ACL/URLs, cloud external private bucket provisioned, credential provider chain, no committed secrets. Existing server tests need isolated test config (no real cloud credentials). Avoid silently redirecting existing locators when changing provider/bucket; data migration out of scope. Bound connection, socket inactivity, per operation and stream resource management; PUT exactly one attempt non-configurable, read max three; no timeout is settlement evidence. No global liveness failure for temporary storage outage; report storage health. Local staging directory exclusive lock and temp files ignored from git. Operator guide describes configuration, disk budgets, privacy, backup/migration caveat and ARM64 limitation. Reverse proxy limits and future HTTP request overhead in #78; do not add HTTP endpoints in #76.

Metrics: `horizon.file.transfer.duration`, `.transfer.outcomes`, `.staging.active`, `.staging.bytes`, `.validation.rejections`, `.storage.errors`; low cardinality tags, no owner/file names, checksums, object contents, credentials or raw locators in public responses; bounded safe logging, health/Actuator existing conventions. Worker backlog and alerts #77.

## 10. Deliverables, verification and acceptance

Backend `server/src/main/java/com/krishnamurti/horizon/file/{api,application,domain,infrastructure/{persistence,storage/s3,staging,validation}}`; tests mirror package, test-only transactional caller; one Flyway migration (or migration sequence per existing conventions), POM, app config, Compose/bootstrap and local operator docs. No frontend or existing production Note/Task edits. Use accompanying plan for exact proposed paths and tests.

Required verification: real PostgreSQL constraints/rollback, real pinned SeaweedFS contract Put/Head/Get/Delete private auth and restart persistence, unit validation for all allowed formats and adversarial inputs, effective default/50/100 MiB and over ceiling, configuration discovery, concurrent prepare/claim/winner selection, staging cleanup/exhaustion/disk full, checksum/length before PUT, identity conflicts and scope isolation, no unclaimed/incomplete reads, DB commit failure before/after PUT, lost response and uncertain locator retention, late PUT/expiry/removal races, no key reuse or SDK retry, #77 handoff. Test-only caller must demonstrate claim/cleanup rollback with caller association surrogate; no production Note wiring. Run `cd server && ./mvnw test && ./mvnw verify`; Docker-dependent tests may not silently skip. Record test output and provider pins/architecture, dependency/security checks and fault evidence. No claim automated recovery until #77. Manual Compose smoke authenticated health, bootstrap repeatability, recreate container retaining bytes, anonymous denial, configuration override; no actual private user data fixtures.

## 11. Review gates and open mechanical details

All eleven design decisions approved, but the consolidated spec/plan has not been reviewed, published or built. Mechanical DTO completions, internal signatures, canonical encoding framing, exact new filenames and decimal megapixel interpretation above are explicit review proposals, not independently approved policy. If reviewer disagrees, correct them before execution. Parser hard bounds, accepted MIME alias map, strict parser behaviour, ratio/CPU/heap budgets, and runtime evidence of exact single PUT must be established; where existing library defaults are inadequate or ambiguous, request user review before selecting new policy. No claim that in-process parsing is a full sandbox. Use conservative behavior and do not invent settlement conditions. Any conflict with live sources, dependencies, architecture, platform or tests is a stop-and-report gate, not permission to change scope.

Definition of done: source amendments accepted, plan reviewed, tests and standard CI green, manual smoke documented, no boundary violations, #77 durable handoff documented, no speculative additions, ready for review/merge under normal workflow. HORIZON_STATUS updated only after actual verified delivery; no changes to foundational Constitution unless separately necessary/approved.
