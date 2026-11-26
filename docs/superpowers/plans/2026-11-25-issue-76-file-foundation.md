# Issue #76 — Shared File foundation Implementation Plan

> **For agentic workers (Luna):** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for inline task-by-task execution, `superpowers:test-driven-development` for each implementation task, and `superpowers:verification-before-completion` before reporting success. No subagents. Steps use checkboxes. Do not begin production code until the human has reviewed this consolidated handoff and the source reconciliation gate is satisfied.

**Goal:** Deliver a private, provider-independent File module foundation with bounded validated transfers, committed per-PUT attempt records and atomic caller-controlled claims.

**Architecture:** Logical File plus physical attempt tables in PostgreSQL; public `file.api.FileService` and `FileCapabilities`; internal `ObjectStorage` port with one S3 adapter. External I/O occurs outside database transactions; #77 owns scheduled recovery, #78 owns Note authorization and associations.

**Tech Stack:** Java 25, Spring Boot 4.0.6, Spring Data JPA, Flyway, PG17, AWS SDK Java v2 2.59.2, SeaweedFS 4.54 pinned, ImageIO + TwelveMonkeys 3.15.3, PDFBox 3.0.8, POI 6.0.0, JUnit, existing Testcontainers, Toxiproxy 2.13.0.

**Spec:** `docs/superpowers/specs/2026-11-25-issue-76-file-foundation-design.md` (provided alongside this plan). Read §§3–11 and approved decision register before starting.

## Global Constraints

- No public HTTP endpoints, frontend, Note/Task/Journal production integration, `note_file`, File→workspace callback, global Files workspace, generic job framework, worker scheduling, presigned/public URLs, alternative production provider, multipart/resume, data migration or quota.
- Default maximum 20,971,519 B inclusive; hard ceiling 104,857,600 B inclusive. Known positive length and client SHA-256 mandatory. Current limit for new/unverified uploads; previously verified files remain valid. 24h default expiry, captured on prepare.
- Four default concurrent staging/transfers, 64 KiB copy buffer, derived payload budget (max bytes × concurrency, optional override), scratch <=128 MiB per validation, restricted dedicated staging and exclusive startup lock. Parser limits in spec §6; validate full content before registering attempt or PUT.
- Global idempotency UUID, versioned length-prefixed UTF-8 fingerprint, trusted scope, one logical File, one never-reused physical key per actual PUT. Every PUT locator committed first; one network PUT per attempt, no implicit retry or replay. Independent streaming GET + size/SHA verification; no ETag assumption.
- Short PG transactions; prepare/claim/cleanup MANDATORY, transfer/read orchestration NEVER; workspace → File → attempt lock order, first eligible verified commit wins, no S3 I/O under DB locks/transactions. No selected pointer replacement or second claim. No new read after committed cleanup; already-admitted stream may finish.
- PENDING after crash may be UNKNOWN; timeout, lease expiry, negative HEAD, expiry, DELETE response do not prove write settlement. Preserve unresolved locators indefinitely. #77 owns worker/compaction, no fabricated finite retirement condition. No claim that automated cleanup already works.
- UUID application generation, no BaseEntity changes, explicit ID mappings, Flyway SQL-only, Hibernate validate, no triggers/cascades. Exact schema and API in spec; no SDK types outside adapter.
- Pin dependencies as approved; verify compatibility/security. SeaweedFS digest `sha256:e7d4b80af9bd49b2630a60ac6fbb7ffb620ac6a2c501f689c22a71b9f89f0203` (linux/amd64); Toxiproxy digest `sha256:5d3dae09bc185dcc5ff6cf43abf6062a4a720aff0c4306a471e773acdcd107aa`; no unreviewed ARM64 pin, no merge of #94 POC. 5s connect, 30s socket, 5m per operation, 3 read attempts, 1 PUT attempt.
- Review gate: any unresolved security limits, parser inability, MIME policy, schema/API ambiguity or dependency substitution must be raised with user. Do not silently choose new behavior. Preserve approved #68 workflow and unaffected Task status.
- Existing repository conventions and build quality gates; real PG and SeaweedFS acceptance tests, no silently skipped Docker tests. No unrelated refactoring. Use isolated worktree/branch per existing workflow if executing; do not push/merge without authorization.

## Review Focus

1. A lost PUT response after actual 200 must not cause same-key retry or permanent locator loss (Task 9).
2. Lowered deployment max must not invalidate an existing verified file, but must reject newly unverified transfers (Tasks 1, 7, 8).
3. Two simultaneous transfers or a late result after expiry/cleanup must never change a winner or resurrect a file (Task 9).
4. Malformed/compressed content, truncated images and invalid text must not consume unbounded resources or reach S3 (Tasks 4–5).
5. A second server using the same staging directory must not sweep another process's live files (Task 4); cleanup/claim rollback with caller's transaction must preserve integrity (Task 8).

## File map and execution conventions

All paths below are repo-relative. To reduce repeated long paths, **J = `server/src/main/java/com/krishnamurti/horizon/`**, **T = `server/src/test/java/com/krishnamurti/horizon/`**, **R = `server/src/main/resources/`**. Expand these literally; they are not shell variables unless explicitly exported. `file/` under J/T is the new module. New internal filenames and DTO completions are proposed mechanical choices from the spec and subject to final human review; public signatures and schema follow D76-08/09. Existing server test convention uses `@SpringBootTest`, `@Import(TestcontainersConfiguration.class)` for PG. Keep existing tests isolated by supplying test storage configuration or a test port implementation only where real S3 is not the subject. Never point tests to a real cloud bucket. For each test command below run from repo root as `cd server && ./mvnw test -Dtest=ClassName` (or comma-separated classes). Use JUnit assertion semantics; names/assertions below specify observable behavior, fixture helper internals are implementation details, not existing methods. Each red run must fail for the intended missing behavior, not due to Docker/config failure; each green run must pass before committing. Commit only named task files, do not stage unrelated changes. Existing Maven commands `./mvnw test`, `./mvnw verify` remain authoritative.

---

### Task 0 — Reconcile accepted requirements and establish execution baseline (blocking gate)

**Files:** spec and plan paths above; `docs/architecture/adr/ADR-010-shared-file-object-storage.md`; authoritative knowledge-store PRD-005 and PRD-000 (discover exact live paths); issues #76, #78, #79, #80, Epic #4 as applicable; `server/AGENTS.md`, `docs/ai/ENG-001 Engineering Guidelines v1.0.md`, `server/pom.xml`, `server/compose.yaml` (read). Read #68 accepted design and #75 report; POC source read-only, no merge.

- [ ] Verify master SHA, existing migrations and files, #75 acceptance, #4 child sequence, #68 closure and #77/#78 scope. Confirm no competing File implementation; baseline `cd server && ./mvnw verify`. Capture output and any existing failures. Do not silently fix unrelated issues.
- [ ] Search both repos and issue text for fixed-size literals specified in spec §4. Prepare minimal source amendments using exact approved default/ceiling and no retroactive invalidation. Preserve historical POC and #68 artifacts; link new policy explicitly. Do not alter unrelated product or architecture decisions. Show diff and obtain normal approval for publishing/merging authoritative changes; record resulting refs. If unable to reconcile, stop. This is a documentation gate, not a code TDD task.
- [ ] Verify approved Maven artifacts, managed Testcontainers alignment, transitive dependencies and vulnerability assessment, runtime platform/digest. Inspect actual SDK retry semantics, ImageIO animated WebP, PDFBox strict loading and POI limits APIs; identify any unresolved parser bounds or ratio/CPU/heap policy and obtain review before inventing limits. Record evidence and review outcome. If Docker or dependency security gate fails, report blocker, no substitution.
- [ ] Confirm exact DTO completions, fingerprint framing, filename/MIME policy and derived lifecycle priority in spec; if unresolved obtain user review before relevant code. Use `superpowers:using-git-worktrees` if isolation needed and available. Commit approved docs separately (appropriate repositories); no automatic merge. Verify spec/plan present at intended paths and referenced by #76 when publishing is authorized.

### Task 1 — Typed configuration and upload policy contract

**Files:** Modify `server/pom.xml`, `R/application.yaml`; create `J/file/infrastructure/FileProperties.java`, `J/file/api/FileCapabilities.java`, `J/file/api/model/FileUploadPolicy.java`, `J/file/api/model/FileFormat.java`, `J/file/application/DefaultFileCapabilities.java`; test `T/file/infrastructure/FilePropertiesTest.java`, `T/file/application/FileCapabilitiesTest.java`.

**Interfaces:** `FileProperties` binds `horizon.file` settings (spec §9); `FileCapabilities.getUploadPolicy(): FileUploadPolicy`; `FileUploadPolicy(long maxFileSizeBytes, Set<FileFormat> supportedFormats)`; enum in spec §5. Properties expose effective bytes, expiry, staging and parser limits, S3 options. No provider settings in public record.

- [ ] Write failing tests: `defaultsPreserveStrictTwentyMiB` asserts max=20_971_519, expiry=24h, slots=4, buffer=65_536, derived budget=83_886_076; `supportsEnvironmentOverride` binds explicit `HORIZON_FILE_MAX_FILE_SIZE=50MB` and asserts 52_428_800; `allowsInclusiveCeiling` asserts 104_857_600; `rejectsInvalidStartupProperties` covers zero/negative, ceiling+1, invalid durations, capacity smaller than one max file and arithmetic overflow; `policyExposesOnlyEffectiveLimitAndFormats` asserts exact allowlist incl aliases by mapping and immutable set; `parserLimitsAreIndependentOfPayloadLimit` asserts spec values unchanged at 100MiB.
- [ ] Run `./mvnw test -Dtest=FilePropertiesTest,FileCapabilitiesTest`; expect RED for missing config/contract.
- [ ] Implement above properties, validation, public record and capabilities. Add approved Maven pins/BOM and only needed dependencies after Task 0; do not alter existing Boot or PG version. Explicit env placeholders; optional staging budget derives from max × slots. Supply separate test configuration for existing context tests without cloud secrets, preserve unrelated config. Invalid configuration fails startup; temporary S3 unavailability does not.
- [ ] Rerun same command; expect PASS. Run `./mvnw dependency:tree`; document actual resolved versions and security results.
- [ ] Commit named files: `feat(file): add validated deployment policy and capabilities`.

### Task 2 — Logical API records, fingerprint and lifecycle policy

**Files:** Create `J/file/api/FileService.java`; `api/command/{PrepareFileCommand,TransferFileCommand,ClaimFileCommand,CleanupFileCommand}.java`; `api/query/{InspectFileQuery,ReadFileQuery}.java`; `api/model/{FileScope,FileReference,FileDescriptor,FileSnapshot,FileMetadata,FileLifecycle,TransferDisposition,TransferResult,ClaimResult,FileContent}.java`; `J/file/domain/{FileRequestFingerprint,FileLifecyclePolicy,TransferOutcome}.java`; test `T/file/domain/{FileRequestFingerprintTest,FileLifecyclePolicyTest}.java`, `T/file/api/FileContractTest.java`.

**Interfaces:** Public method signatures/records in spec §5, `FileRequestFingerprint.compute(FileScope,FileDescriptor): String`, `FileLifecyclePolicy.derive(Instant now, Instant expiresAt, UUID selectedAttemptId, Instant claimedAt, Instant cleanupRequestedAt, Instant purgedAt): FileLifecycle`; technical `TransferOutcome` per §8. `FileContent.close()` delegates to the stream. Fingerprint helpers versioned; scope/workspace validation and exceptions follow approved semantic mapping.

- [ ] Write failing tests: `canonicalVectorIsStable` uses v1 big-endian UTF-8 length framing and fixed vector (compute independently from reviewed spec, save exact input and expected digest in test); `changedIdentityChangesFingerprint` parameterizes user/workspace/binding/name/MIME/size/SHA changes; `lengthPrefixPreventsAmbiguousConcatenation` covers multi-byte and split-boundary fields; `expiryBoundaryAndClaimPriority` asserts exact now==expiry EXPIRED when unclaimed, CLAIMED after expiry when claimed; `cleanupAndPurgeTakePrecedence` asserts terminal precedence; `closeReleasesReadStream` verifies close exactly once per call/stream ownership; `apiDoesNotExposeProviderTypes` checks public types/imports for no AWS SDK, persistence, HTTP classes.
- [ ] Run `./mvnw test -Dtest=FileRequestFingerprintTest,FileLifecyclePolicyTest,FileContractTest`; expect RED for missing types/policy.
- [ ] Implement approved API records/enums, reviewed canonicalization and lifecycle policy; no persistence in this task. Public inputs validate shape but do not imply authorization. Avoid leaking metadata on wrong scope; immutable policy/set. Use existing exception conventions, not a new global HTTP framework.
- [ ] Rerun same command; expect PASS.
- [ ] Commit named files: `feat(file): define provider-neutral API and identity policy`.

### Task 3 — Flyway schema and persistence

**Files:** Create `R/db/migration/V20261125000000__create_file_foundation.sql` (verify free timestamp against live migrations first); `J/file/domain/{FileMetadataEntity,FileTransferAttemptEntity}.java`; `J/file/infrastructure/persistence/{FileMetadataRepository,FileTransferAttemptRepository}.java`; test `T/file/infrastructure/persistence/FilePersistenceIntegrationTest.java`. Existing schema user FK `users(id)` must be verified against live DDL.

**Interfaces:** Repository operations: lookup by idempotency key, conflict-safe insert-or-find logical File, scoped identity read, `lockById(UUID)` (pessimistic write), `findByFileId(UUID)` for attempts, lock attempt by File/id, persist and flush. Exact JPA signatures review against ENG-001; use explicit ID fields, no graph or cascade. SQL atomic insert-on-conflict then select existing row in same transaction; use persistence adapter as necessary rather than catch aborted constraint errors.

- [ ] Write PG tests: `schemaMigratesAndHibernateValidates`; `idempotencyKeyIsGloballyUnique`; `crossFileSelectedAttemptRejected`; `invalidShaAndOutcomeRejected`; `hardCeilingAcceptedAndAboveRejected` (104857600/104857601); `activeMetadataCannotBeNull`; `unsettledAttemptCannotLoseLocator`; `cleanupConfirmationRequiresSettlement`; `userDeletionDoesNotCascade`; `purgedFactsAllowMinimalTombstoneWithoutReusingAttemptId`; `rowLocksSerializeMutation`. Use real SQL inserts/updates and assert constraint failures, include nullable CHECK cases.
- [ ] Run `./mvnw test -Dtest=FilePersistenceIntegrationTest`; expect RED from absent schema/constraints.
- [ ] Implement spec §8 exact columns, composite selected-attempt FK, unique constraints and partial indexes, JPA enum STRING + checks and application UUIDs/Instant. Ensure migration order allows circular FK with nullable selected ID. No automatic physical compaction, worker scheduling, leases or triggers. Do not modify BaseEntity or unrelated migrations.
- [ ] Rerun same command against PG; expect PASS, Flyway and Hibernate validation clean. Inspect actual indexes and FK behavior.
- [ ] Commit: `feat(file): persist logical identity and durable transfer attempts`.

### Task 4 — Bounded local staging

**Files:** Create `J/file/infrastructure/staging/{FileStagingService,StagedFile,StagingCapacity,StagingDirectory}.java`; test `T/file/infrastructure/staging/FileStagingServiceTest.java`, `StagingDirectoryTest.java`.

**Interfaces:** `FileStagingService.stage(InputStream input, long declaredLength, FileDescriptor expected): StagedFile`; `StagedFile` closeable, exposes `Path`, actual bytes, SHA-256; `StagingCapacity` reserves/releases payload and slot before copy, scratch budget accounted separately. No caller stream closure. `StagingDirectory` owns exclusive process lock and startup cleanup of its abandoned artifacts.

- [ ] Write failing tests `exactLengthAndDigestStaged` asserts known fixture size/SHA and cleanup on close; `lengthMismatchAndChecksumMismatchCleanUp` covers short/long and wrong SHA; `defaultBoundaryAndConfiguredCeiling` uses generated streaming fixtures (20_971_519 accepted, 20_971_520 rejected at default, 104_857_600 accepted at ceiling, ceiling+1 rejected); `unknownOrNonpositiveLengthRejectedBeforeRead`; `capacityExhaustedIsRetryable` fills four slots and verifies fifth does not stage; `diskFullOrWriteFailureReleasesReservation`; `callerOwnsStream`; `secondProcessCannotSweepActiveFiles`; `startupRemovesOnlyAbandonedOwnedFiles` covers symlink/unrelated-file safety and failed lock. Assertions include no residual staged payload and no capacity leak.
- [ ] Run `./mvnw test -Dtest=FileStagingServiceTest,StagingDirectoryTest`; expect RED.
- [ ] Implement streaming 64KiB buffer and incremental `MessageDigest`, max length enforced during copy (at most one extra detection byte), generated names/permissions, fail-fast capacity and disk checks, deterministic close/finally cleanup, lock and bounded startup sweep. Reserve payload/scratch accounting before use, never use full byte array or caller filename as path; handle overflow. Use a test fault seam for disk write failure plus real constrained-space smoke if available. Do not rely on `deleteOnExit`.
- [ ] Rerun same command; expect PASS, no leaked locks/files/permits. Document POSIX/platform limitations and review if unable to secure permissions.
- [ ] Commit: `feat(file): add bounded disposable staging`.

### Task 5 — Structural validation strategies

**Files:** Create `J/file/infrastructure/validation/{FileValidator,FileValidationService,ValidationResult,ImageFileValidator,PdfFileValidator,OfficeFileValidator,TextFileValidator}.java`; test `T/file/infrastructure/validation/{ImageFileValidatorTest,PdfFileValidatorTest,OfficeFileValidatorTest,TextFileValidatorTest,FileValidationServiceTest}.java`; sanitized/generated fixtures under `server/src/test/resources/file/fixtures/` with provenance README.

**Interfaces:** `FileValidator.supports(FileFormat): boolean`, `validate(StagedFile): ValidationResult`; `FileValidationService.validate(StagedFile,FileDescriptor): ValidationResult`; result carries detected `FileFormat` and validated media type, not parser-specific objects. Format selection validates expected extension/MIME and actual signature; all policies spec §6. If exact MIME alias/text policy or parser bounds are not resolved at Task 0, stop for review before accepting formats.

- [ ] Write failing image tests `validStaticAndAnimatedFormatsAccepted` (JPEG/JPG, PNG, GIF, WebP incl animated); `truncatedOrSpoofedImageRejected`; `dimensionsFramesAndCumulativePixelsBounded` asserts 8192 width/height, 16MP canvas, 100 frames, 64MP cumulative; assert decoder not asked to allocate beyond limit.
- [ ] Write failing PDF tests `validPdfAccepted`; `malformedEncryptedAndActivePdfRejected`; `pageAndScratchBudgetEnforced` (1000 pages, 128MiB scratch); no external resolution or silent repair.
- [ ] Write failing Office tests `validDocxXlsxPptxAccepted`; `wrongPackageTypeMacroAndExecutableRejected`; `zipDuplicateTraversalAndExternalEntityRejected`; `archiveBoundsEnforced` (2048 entries, 32MiB per expanded entry, 128MiB total, compression ratio guard); `ordinaryHyperlinkNotFetched` (no network access). Use actual expanded byte counting including false ZIP headers.
- [ ] Write failing text tests `validUtf8AndBomAccepted` for TXT/MD/CSV/MMD/MERMAID; `invalidUtf8BinaryHtmlSvgExecutableRejected`; `markdownHtmlSnippetRemainsInertText`; `declaredMimeAndExtensionSpoofRejected` across validator families. `FileValidationServiceTest` verifies one correct strategy per format, no unsupported fallback.
- [ ] Run `./mvnw test -Dtest=ImageFileValidatorTest,PdfFileValidatorTest,OfficeFileValidatorTest,TextFileValidatorTest,FileValidationServiceTest`; expect RED for missing validation.
- [ ] Implement each strategy using approved libs and bounded resources; check header/structure before allocations, decode frames sequentially, no previews or document execution. Do not trust signature alone, archive metadata or parser leniency. Implement approved strict policies; independent parser scratch admission and closure. Document actual parser limits, CPU/heap/disk evidence, library gaps; if in-process safety cannot be demonstrated, stop and request decision, do not downgrade policy.
- [ ] Rerun same command; expect PASS including actual static/animated WebP and all approved formats. Record fixture results and resource profiles.
- [ ] Commit: `feat(file): validate allowlisted formats before storage`.

### Task 6 — Provider port, real S3 adapter and private local deployment

**Files:** Create `J/file/application/port/{ObjectStorage,ObjectKey,ObjectWriteRequest,WriteResult,ObjectMetadata,StoredObject,DeleteResult}.java`; `J/file/infrastructure/storage/s3/{S3ObjectStorage,S3Configuration}.java`; modify `server/compose.yaml`, `R/application.yaml`, repo ignore rules as needed; create `server/storage/` bootstrap/config artifacts (review exact script names with live POC commands; proposed `bootstrap.sh`, `seaweedfs-s3.json` template, no embedded production secret); test `T/file/infrastructure/storage/{ObjectStorageContractTest,S3ObjectStorageIntegrationTest}.java`, test container fixture `T/file/infrastructure/storage/SeaweedFsTestConfiguration.java`. Operator doc proposed `server/storage/README.md`.

**Interfaces:** `ObjectStorage.put(ObjectWriteRequest): WriteResult`, `.head(ObjectKey): ObjectMetadata`, `.get(ObjectKey): StoredObject`, `.delete(ObjectKey): DeleteResult`; provider-neutral records/closeable stream defined in spec §7. S3 adapter returns explicit acknowledged/settled failure/unknown outcome; HEAD missing is not provider outage; DELETE acknowledgement is not write fencing. Configuration from Task 1; SDK credential chain.

- [ ] Write reusable contract tests `privatePutHeadGetDeleteRoundTrip` asserts bytes, known length, metadata, deletion; `unauthenticatedAccessDenied` verifies unsigned request; `providerFailureIsNotNotFound`; `storagePersistsAcrossContainerRecreation` with retained volume; `putMakesExactlyOneNetworkRequest` counts actual outgoing PUTs under controlled fault; `boundedTimeoutReturnsUncertain` tests timeouts; `streamClosesProviderResource`. Test against pinned real SeaweedFS, use authenticated bootstrapping. Adapter architecture test ensures AWS imports only in S3 adapter.
- [ ] Run `./mvnw test -Dtest=S3ObjectStorageIntegrationTest`; expect RED for missing adapter/semantics, not missing Docker. Record provider health and architecture.
- [ ] Implement SDK adapter with known-length staged path request, no retry (incl redirects/replay) on PUT, bounded read retries/operation timeouts, scoped resource handling. Use POC verified client settings; classify ambiguous failures conservatively. Do not use ETag as SHA or assume DELETE/HEAD settles original write. Extend Compose with pinned SeaweedFS persisted volume, loopback endpoint, idempotent authenticated bucket bootstrap, private access, local path style true, no anonymous or public ACL. Use external provisioned private bucket for cloud. Leave PG service intact. Verify container commands against POC, no unapproved image substitutions.
- [ ] Rerun same command; expect PASS. `docker compose -f server/compose.yaml config` (with documented local environment) then local smoke: up, authenticated health/bootstrap twice, put/get, recreate retaining data, unsigned denied. Record exact commands/results, stop/clean only test resources; never delete user's volume.
- [ ] Commit: `feat(file): add private S3 adapter and local deployment`.

### Task 7 — Prepare, inspect and durable transfer orchestration

**Files:** Create `J/file/application/{DefaultFileService,FileTransactions}.java`; internal semantic exceptions under `J/file/application/` per existing convention; test `T/file/application/{FilePrepareIntegrationTest,FileTransferIntegrationTest}.java`; test-only caller `T/file/application/TestFileOwner.java` (`@TestConfiguration`/bean as appropriate). Reuse Tasks 1–6.

**Interfaces:** `FileService.prepare(PrepareFileCommand): FileSnapshot`, `.inspect(InspectFileQuery): FileSnapshot`, `.transfer(TransferFileCommand): TransferResult`; `FileTransactions.registerAttempt(FileReference):` durable attempt snapshot, `recordTransferOutcome(...)` short tx, `loadEligibleTransfer(...)` scoped snapshot (internal signature completion reviewed against spec). Use `TransactionTemplate` or separate managed transactional methods, no self-invocation. TestFileOwner wraps MANDATORY calls in caller tx. For this incremental task claim/read/cleanup are not exposed as working until Task 8; avoid permanent unsupported stubs and keep branch unmerged. Implement all public operations by Task 8.

- [ ] Write failing `FilePrepareIntegrationTest` cases `sameRequestReturnsSameLogicalFile`, `incompatibleOwnerBindingMetadataConflictWithoutDisclosure`, `concurrentPrepareProducesOneRow`, `prepareRequiresCallerTransaction`, `expiredReplayDoesNotResurrect`, `inspectIsScopeCheckedAndNoStorageIO`, `prepareRollbackLeavesNoReservation`, `reducedLimitDoesNotInvalidateHistoricalReplay` (new oversize rejected, existing replay retained).
- [ ] Write failing `FileTransferIntegrationTest` cases `validatedTransferRegistersCommittedLocatorBeforePut` (separate DB connection sees attempt; no ambient tx in storage spy), `noPutOnInvalidOrOversizeBytes`, `verifiedResultRequiresMatchingRemoteGetDigest`, `repeatVerifiedTransferDoesNotPutAgain`, `transferRejectsAmbientTransaction`, `storageFailureKeepsDurableAttempt`, `unverifiedTransferAfterLimitReductionRejected`, `unclaimedExpiryBoundaryPreventsRegistration`. Test actual private provider for successful round trip, mock/fault port only for targeted failure observation. Assert stream caller ownership and staged file cleanup.
- [ ] Run `./mvnw test -Dtest=FilePrepareIntegrationTest,FileTransferIntegrationTest`; expect RED.
- [ ] Implement prepare with global unique key/conflict-safe insert and scope/descriptor comparison, immutable metadata/versioned fingerprint, expiry captured. Inspect derived lifecycle and generic wrong-scope error. Transfer NEVER, stage and validate, short transaction with File lock recheck, commit PENDING locator derived from new attempt UUID, one network PUT + streamed GET length/SHA, short outcome transaction with first eligible verified commit wins; losing/late attempts marked for cleanup and tracked. Acknowledged PUT and independently verified bytes required for selection; uncertain response retains UNKNOWN, even if negative HEAD. Never mark FAILED without settlement. No remote I/O in database tx. Return approved transfer dispositions; validation failures are semantic exceptions.
- [ ] Rerun same command; expect PASS. Include assertion that before remote PUT no transient uncommitted metadata is relied upon.
- [ ] Commit: `feat(file): orchestrate idempotent prepare and verified transfer`.

### Task 8 — Atomic claim, private read and cleanup intent

**Files:** Modify `J/file/application/{DefaultFileService,FileTransactions}.java`, persistence repositories as needed; test `T/file/application/FileOwnershipIntegrationTest.java`, modify test-only `TestFileOwner.java` and add caller-owned association surrogate in test setup (no production Note schema).

**Interfaces:** `FileService.claim(ClaimFileCommand): ClaimResult`, `.openRead(ReadFileQuery): FileContent`, `.requestCleanup(CleanupFileCommand): void`. Claim and cleanup MANDATORY, read orchestration NEVER with short DB eligibility query, no remote IO in tx. Caller test surrogate transaction must prove rollback of both mutations; use temporary/test-only schema fixture not a production migration.

- [ ] Write failing tests `prepareTransferClaimReadRoundTrip` asserts original bytes, owner scope, no provider types/locators; `unclaimedUnverifiedExpiredOrWrongScopeCannotRead`; `concurrentClaimHasOneWinner` (second ALREADY_CLAIMED cannot create association); `claimAndCallerAssociationRollbackTogether`; `cleanupAndCallerDetachRollbackTogether`; `claimAfterCleanupOrExpiryConflicts`; `cleanupRequestIdempotentNoSynchronousDelete`; `newReadDeniedAfterCommittedCleanup`; `existingReadStreamCanFinishAndClose`; `claimedHistoricalFileReadableAfterReducingLimit`; `claimAndCleanupRequireCallerTransaction`; `readOutsideTransaction`. Assert caller rollback preserves metadata and logical access exactly; no remote I/O under DB transaction.
- [ ] Run `./mvnw test -Dtest=FileOwnershipIntegrationTest`; expect RED.
- [ ] Implement conditional claim under File lock, same caller transaction, no re-claim, eligible verified pointer and current expiry; request cleanup timestamp idempotently in same transaction, no physical DELETE; read authorize via trusted scope and claimed/no cleanup verified selection, short snapshot then streaming port GET, caller closes stream. On error close resource and expose safe semantic failure. Do not add Note authorization or association production code. Remove any temporary incomplete implementation from Task 7.
- [ ] Rerun same command; expect PASS; rerun Tasks 2/3/7 relevant tests. Full public interface now implemented.
- [ ] Commit: `feat(file): enforce exclusive claim and private read lifecycle`.

### Task 9 — Production fault and concurrency foundation acceptance

**Files:** Create `T/file/application/{FileTransferFailureIntegrationTest,FileConcurrencyIntegrationTest,FileRestartIntegrationTest}.java`; test fault fixture `T/file/infrastructure/storage/S3FaultHarness.java` using pinned Toxiproxy and controlled response gate where needed, not merged POC harness. Modify production transaction/adapter code only for demonstrated defects within approved design.

**Interfaces:** Full FileService/port; durable rows inspected through test queries, not new production API. Fault harness must observe request/response and release barriers deterministically; no sleeps as sole race synchronization. Reproduce relevant #75 scenarios against actual production File service; #77 owns worker end-to-end races.

- [ ] Write failing or characterization tests `dbCommitFailureBeforePutMakesZeroNetworkWrites`; `dbFailureAfterSuccessfulPutPreservesCommittedLocator`; `lostSuccessfulPutResponseRetainsUnknownLocator` (provider 200 observed, client response dropped, independent GET proves bytes, no selection); `retryUsesDifferentKeyAndFirstVerifiedCommitWins`; `twoConcurrentTransfersSelectExactlyOneAndRetainLoser`; `lateCompletionAfterExpiryOrCleanupNeverPromotes`; `pendingAttemptSurvivesApplicationRestart`; `negativeHeadAndDeleteAckDoNotSettleUnknown`; `interruptedTransferNeverReadable`; `storageOutageIsRetryableAndDoesNotCorruptExistingFile`; `latePutAfterDeleteRemainsDiscoverable` (controlled held write and delete, then late write, durable locator remains; no worker claim). Assert row/key counts, no repeated actual PUT to same key, no accessible incomplete data, no premature locator retirement, selection immutable. Separate provider outage from missing object.
- [ ] Run `./mvnw test -Dtest=FileTransferFailureIntegrationTest,FileConcurrencyIntegrationTest,FileRestartIntegrationTest`; expect pre-fix failure where behavior missing; existing invariants may already pass (characterization, do not fabricate RED). A12/A14/A15/B07 hazards must be exercised with observable events, not inferred from mock behavior.
- [ ] Fix only demonstrated shortcomings using approved per-attempt-key, transaction and lock rules. If authoritative settlement cannot be proven, retain locator; no lease/timeout-based purge. No scheduled worker, generic queue, production tombstone compaction or Note callbacks. Where a required race cannot be reproduced on actual infrastructure, report test limitation and block acceptance rather than claim success.
- [ ] Rerun same command; expect PASS and documented fault evidence (timestamps/event ordering, outcomes, row counts and pinned provider). Repeat deterministic race scenarios and restart with same database/storage, not fresh volumes. Record which #75 evidence is foundation-tested and which #77 worker cases remain deferred.
- [ ] Commit: `test(file): prove durable transfer failure and concurrency invariants`.

### Task 10 — Observability, configuration documentation and boundary verification

**Files:** Create `J/file/infrastructure/{FileMetrics,FileStorageHealthIndicator}.java`; modify relevant staging/application/adapter classes and `server/storage/README.md`; test `T/file/infrastructure/{FileObservabilityTest,FileModuleBoundaryTest}.java`; document #77 handoff in story spec/plan completion record (or approved engineering doc location). Existing `server/compose.yaml` and config verified, no UI changes.

**Interfaces:** Metrics and health via existing Actuator/Micrometer conventions; metric names spec §9, bounded tags; storage health checks authenticated availability without external write, temporary storage failure not app liveness. No new public routes.

- [ ] Write failing tests `metricsUseBoundedTagsAndNoSensitiveValues`, `stagingGaugesReleaseAfterFailure`, `transferOutcomeMetricsDifferentiateUnknown`, `storageOutageDoesNotAffectLiveness`, `noAwsImportsOutsideAdapter`, `noFileToWorkspaceRepositoryDependency`, `noHttpEndpointsInFileModule`. Verify provider exception details sanitized; no filenames, IDs, checksums, keys or credentials in metrics labels/public error messages. Use actual existing architecture test conventions or minimal reflection/source dependency check, no new framework without review.
- [ ] Run `./mvnw test -Dtest=FileObservabilityTest,FileModuleBoundaryTest`; expect RED for missing observability/boundary protection.
- [ ] Implement metrics/health and safe structured logging. Document all effective config defaults/overrides, disk budget including scratch, local startup commands/bootstrap, credential chain, platform caveat, externally provisioned cloud bucket, no provider/bucket switch without migration, recovery limitations. Record #77 required fields/lock order and indefinite retention, #78 capability discovery and authorization obligations. No worker-specific scheduling/alerts until #77.
- [ ] Rerun same command; expect PASS. Inspect code diff for no production Note/Task/Journal modifications, no SDK leakage and no new public endpoint.
- [ ] Commit: `feat(file): expose operational diagnostics and document storage setup`.

### Task 11 — Whole-story verification and handoff

**Files:** Existing code/docs from previous tasks; update completion evidence in approved story location; source amendments and #76 links/status only under normal authorization. No speculative fixes or feature expansions.

- [ ] Run full `cd server && ./mvnw test && ./mvnw verify`. Ensure Docker-required suites actually run, count tests and skips; Spotless, ErrorProne, SpotBugs, JaCoCo/CI checks per existing POM. Capture exit codes and logs. No test-disable flags or fake success. Repeat dependency/security evidence after final resolution.
- [ ] Manual smoke with fresh isolated Compose resources and retained volumes: authenticated private storage, bootstrap idempotence, app restart, 50MiB env override, invalid >100MiB startup failure, anonymous denial, missing storage health degradation, no unintended deletion. Exercise default and ceiling boundary tests; no real user data. Do not alter existing production/dev volumes unexpectedly.
- [ ] Review spec acceptance matrix: all #76 acceptance bullets, all eleven D76 approvals, PRD reconciliation, #68 non-regression, no #77–80 scope leakage. Review fault evidence and database constraints (including nullable columns). Record each test class, exact result, unresolved risks and blockers. If any missing, report and fix within approved scope or ask decision.
- [ ] Verify normal CI after branch push only if authorized. Provide handoff: source amendment PRs/refs, feature branch/commits, tests, provider pins, effective configuration, remaining #77/#78 prerequisites, no claim of worker completion. Update HORIZON_STATUS only after actual accepted delivery per workflow. Request review before merge; no automatic merge or issue closure.
- [ ] Commit only approved documentation/evidence if needed: `docs(file): record issue 76 verification and recovery handoff`.

## Coverage and self-review

| Requirement | Task |
|---|---|
| Source change / no Task status change / #68 boundaries | 0, 11 |
| Configurable limit, policy discovery, parser-independent limits | 1, 4, 7, 8 |
| Provider-neutral API and fingerprints | 2, 7, 8, 10 |
| Two-table schema, UUID, constraints, no cascade | 3 |
| Bounded staging and format validation | 4, 5 |
| Private storage, portability, no retry, Compose restart | 6 |
| Committed intent, verified selection, idempotency | 7, 9 |
| Exclusive claim, read, atomic cleanup intent | 8 |
| Fault evidence, UNKNOWN retention, concurrency | 9 |
| Metrics, docs and architecture checks | 10 |
| Build gates, CI and delivery evidence | 11 |

Self-review performed inline: spec requirements traced to tasks, public signatures and paths aligned with spec, each coding task has test assertions/RED/implementation/GREEN/commit, characterization tests honestly distinguished from RED; five review-focus risks have corresponding tests. No independent reviewer/subagent dispatched. Remaining **review gates** are explicitly recorded in spec §11 and Task 0 (mechanical DTO/encoding details, MIME policy, parser hard bounds/CPU/heap and library compatibility). The plan does not authorize a new policy where those tests or source checks fail. No production build or tests have been run while authoring this document. No repository publication or authoritative amendment is implied by these local files.
