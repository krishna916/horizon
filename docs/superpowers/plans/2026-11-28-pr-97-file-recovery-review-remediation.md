# PR #97 File Recovery Review Remediation Implementation Plan

> **For Luna:** REQUIRED SUB-SKILLS: `superpowers:executing-plans`, `superpowers:test-driven-development`, and `superpowers:verification-before-completion`. Execute every task and review inline in the existing normal checkout. **No worktrees, no subagents, no delegation, no additional PR.** Human-approved override of any conflicting skill defaults. Track checkboxes only after actual evidence.

**Goal:** Close F97-01–F97-07 on PR #97, prove all previously missing production recovery cases, and return the same PR for final human review only when R5 and every applicable required CI check pass.

**Architecture:** Preserve the approved File-owned PostgreSQL queue, immutable per-network-PUT key, parent-first short transactions, fencing leases, conservative UNKNOWN reconciliation and managed single-thread scheduler. Changes are targeted regression tests, shutdown coordination, evidence-driven query improvements only if necessary, and operational validation; do not redesign the recovery protocol.

**Tech stack:** Java 25, actual master Spring Boot 4.0.10, PostgreSQL 17, Flyway SQL, Testcontainers, pinned SeaweedFS 4.54, AWS SDK v2, Micrometer, JUnit/AssertJ, Maven, Node 24/Playwright/GitHub Actions/SonarCloud.

**Spec:** [Approved design](../specs/2026-11-27-issue-77-file-recovery-design.md), [original implementation plan](./2026-11-27-issue-77-file-recovery.md), [independent review F97-01–07](https://github.com/krishna916/horizon/pull/97#pullrequestreview-6097763056), [issue #77](https://github.com/krishna916/horizon/issues/77), [ADR-010](../../architecture/adr/ADR-010-shared-file-object-storage.md), [#75 POC summary](../../architecture/validation/ISSUE-75-SEAWEEDFS-S3-POC-REPORT.md). Historical per-case POC evidence: [report on experimental branch](https://github.com/krishna916/horizon/blob/poc/75-s3-compatibility/server/poc/s3-compat/results/REPORT.md), read-only reference; never merge #94.

**Baseline:** PR #97 head `0789006b201bac6e7e988391ba65493e64a8c076`; master base `d2c11bf64b7af1420d840e71b4b90c267cc85654`; original handoff `4b94f2cd8930da4d20fdfb7d50eb3492580fe8fe`. Previous [CI run 46119876098](https://github.com/krishna916/horizon/actions/runs/46119876098) passed 532 backend tests (zero failures/errors/skips), frontend, Playwright, SonarCloud and quality gate; this is historical baseline, not proof for future commits. The PR already exists, so the original one-final-PR constraint means use this PR only, not open another one.

## Global constraints

- Read root `Agents.md`, `server/AGENTS.md`, `docs/ai/INDEX.md` using align-context, engineering/architecture context and relevant repo skills (git-workflow, testing-spring-integration, cross-module-api, flyway-migration if needed). D77-01–08 and R1–R6 remain unchanged. No arbitrary new decisions; escalate any material conflict or deviation.
- No Note/Task/Trash production code, API or PRD change, broker, generic job framework, dependency or provider-pin change, new public File endpoint, finite UNKNOWN retirement, conditional-PUT production fencing, new storage permission or weakened CI.
- No S3 inside DB transactions. Parent lock before attempt lock. Commit locator before PUT and permanent eligibility fence/lease before DELETE. Only a fresh DELETE initiated after recorded authoritative settlement can confirm terminal cleanup. No HEAD/GET/DELETE/timeout/lease expiry inference of settlement.
- Preserve 24h unclaimed expiry; 30s poll, batch 25, one worker, 10m lease, 30s–1h equal-jitter exponential retry, hourly unsettled ACK revisit, unlimited retries; 30s lease completion margin. No selected live key deletion. Retain all UNKNOWN locators indefinitely if never settled. Keep FK-safe identity/fingerprint tombstones.
- R5 remains a **merge gate**, explicitly retained by human owner. Local pinned-provider success is insufficient for actual deployment. No deployment configuration change, privilege escalation, credentials exposure, or actual-bucket test without operator authorization. Missing R5 evidence does not prevent independent code/test tasks; it prevents final readiness/merge.
- Test only with disposable fixtures. Use bounded latches/barriers, actual PostgreSQL and actual SeaweedFS for production proof, fresh committed queries and independent authenticated reads. Recording storage may supplement, not replace, real-provider fault evidence. For a newly added test that already passes, demonstrate sensitivity by temporarily disabling the relevant guard in the normal checkout, then restoring and verifying it; never commit the mutation or create a worktree. Do not manufacture failures for characterization tests: demonstrate the actual fault and assertions instead.
- Existing production tests/quality gates must not be weakened or skipped. All applicable CI checks must pass at the latest head; no stale successes, no changing CI to bypass checks. No auto-merge/issue close.

## File map

Shorthand paths resolve exactly to F = `server/src/main/java/com/krishnamurti/horizon/file`, T = `server/src/test/java/com/krishnamurti/horizon/file`. All Maven commands run from `server/` (UTC per repo skill; Windows wrapper if applicable).

| File | Work |
|---|---|
| `docs/architecture/validation/ISSUE-77-FILE-RECOVERY-VALIDATION.md` | R5 evidence/status, proof matrix, final verification |
| `docs/architecture/FILE-RECOVERY-RUNBOOK.md` | Correct operational caveats and query parity if needed |
| `T/infrastructure/storage/S3FaultHarness.java` | Combined held PUT/lost response, upstream partial-body/restart barriers |
| `T/application/FileRealProviderIntegrationTest.java` | Real delayed/lost/partial PUT, concurrent winner/loser and DELETE races |
| `T/application/FileRealRestartIntegrationTest.java` | Same DB/object volume across actual app/provider restart |
| `T/application/FileRecoveryCompletionIntegrationTest.java`, `FileRecoveryLeaseIntegrationTest.java`, `FileTransferFailureIntegrationTest.java` | Focused settlement/lease/tombstone regressions as needed |
| `T/application/TestFileOwner.java`, `FileOwnershipIntegrationTest.java`, `FileRecoveryWorkerIntegrationTest.java` | Test-only owner association/version contract and worker |
| `F/application/FileRecoveryWorker.java`, `F/infrastructure/FileRecoverySchedulingConfiguration.java`, `T/application/FileRecoverySchedulerIntegrationTest.java` | Shutdown admission guard and managed lifecycle test |
| `F/infrastructure/persistence/FileRecoveryPersistence.java`, `T/infrastructure/persistence/FileRecoveryPersistenceIntegrationTest.java`, `T/application/FileRecoveryLeaseIntegrationTest.java`, `T/infrastructure/FileRecoveryObservabilityTest.java` | Representative EXPLAIN, all work-kind lock tests, eligibility parity; production query changes only if evidence supports them |

No additional production class/schema change is required by default. If an index change proves necessary, use a new forward Flyway migration, never rewrite a previously applied migration, and escalate any material policy/design change.

## Review focus / explicit regression inputs

1. A held PUT commits after DELETE and loses HTTP 200: locator survives repeated hourly DELETE even when bytes disappear (Task 2).
2. Unsettled ACK crash or lease reclaim races with late settlement: stale tokens cannot clear locator, first ACK cannot become terminal retroactively (Task 3).
3. A live selected object shares a parent with due losing attempts; owner rollback or Trash-equivalent operations cannot delete it (Tasks 3–4).
4. Shutdown begins while first DELETE is blocked; no second work admission, restart recovers any unfinished lease (Task 5).
5. Oldest due row locked or large terminal/UNKNOWN backlog; later eligible rows progress, metrics exclude live winners (Task 6).

---

### Task 0 — Establish baseline and raise R5 evidence request (F97-01, F97-07)

**Files:** read referenced review/spec/plan/repo guides and current CI workflow; modify validation report only if necessary to record the pending gate.

**Interfaces:** existing PR #97 / normal checkout, operator-provided evidence; no production access assumed.

- [ ] Run `git status --short`, `git branch --show-current`, fetch origin and inspect PR #97 head. Switch to existing branch only if safe; reconcile any new changes rather than overwrite. Confirm master baseline and compare current head against reviewed SHA. Read review and original Task 7/8. Stop if unrelated modifications prevent safe work.
- [ ] Confirm exact pins from pom/Compose/test fixture, test isolation, Docker/Java/Node versions. Run baseline targeted File suite and `./mvnw test` / `./mvnw verify`; record outputs. Baseline failure is not a pass; investigate within scope or report.
- [ ] Send one R5 evidence request on PR #97 to the human/operator: which actual deployment/bucket is intended; sanitized provider/version/configuration evidence for private access, never-versioned or proven equivalent non-retention, no Object Lock/retention/replication policy retaining deleted versions; authorized disposable authenticated PUT/GET/DELETE, independent absence and no retained versions/delete markers. Ask for read-only operator evidence if access is unavailable; do not ask for secrets or run an actual-bucket mutation yourself without explicit authorization. The test PUT/DELETE is an operator-approved disposable operation, not a read-only command. If no deployment exists, say so and keep R5 blocked until human-provided evidence satisfies it.
- [ ] In report, separate pinned-provider local test proof from actual deployment proof; mark R5 OPEN until Task 7 validates operator evidence. Continue Tasks 1–6 regardless of R5 availability. Record baseline CI as historical, no final approval.
- [ ] Commit only report changes if any: `docs(file): record R5 evidence request and remediation baseline`.

### Task 1 — Make the real fault harness capable of deterministic combined and partial PUT faults (F97-02/03)

**Files:** modify `T/infrastructure/storage/S3FaultHarness.java`; add focused checks in `T/application/FileRealProviderIntegrationTest.java` and retain existing S3 adapter contract suite.

**Interfaces:** preserve existing constructor `S3FaultHarness(URI, Mode)`, `awaitBufferedPut(Duration)`, `releasePut()`, `awaitCompletion(Duration)`, `putRequests()`; extend test-only enum with `HOLD_PUT_DROP_SUCCESSFUL_RESPONSE`, plus body-barrier/abort mode (name `HOLD_PARTIAL_PUT`). Add `awaitForwardedBody(Duration): void`, `abortUpstream(): void`, `successfulPutResponseObserved(): boolean`, `forwardedBodyBytes(): long`. These are proposed private test-fixture mechanics, not production API. Use actual HTTP response status (200), not mere socket close, as success evidence.

- [ ] Add characterization tests: combined mode receives exactly one PUT, does not forward until release, observes upstream 200, suppresses it and returns UNKNOWN to real storage adapter; independent GET matches bytes. Partial mode actually forwards headers plus a nonzero strict prefix of a valid body, signals barrier before forwarding remaining bytes, supports controlled connection abort or provider restart; verify forwarded bytes are less than actual body length. Existing fixture must not signal completion from a non-PUT bootstrap/GET.
- [ ] Run `./mvnw test -Dtest=FileRealProviderIntegrationTest,S3ObjectStorageIntegrationTest`; verify new assertions fail/missing mode as appropriate.
- [ ] Extend test harness only. Existing `HOLD_PUT` and `DROP_SUCCESSFUL_PUT_RESPONSE` remain unchanged behavior. Track PUT-specific latches/result separately from general HTTP; read/forward exact request headers/body without re-signing or replay. For partial mode use a valid fixture large enough for a meaningful prefix; stream a prefix upstream before blocking remainder, not just buffer locally. Bound waits/socket timeouts; release barriers and close sockets in finally/close; surface unexpected proxy failures rather than count as expected faults. Use independent direct provider client for DELETE/GET; do not deadlock the single proxy executor.
- [ ] Rerun targeted suite, assert old and new cases pass, no skips. Commit `test(file): extend real S3 fault barriers for lost and interrupted writes`.

### Task 2 — Prove combined late PUT and permanently UNKNOWN reconciliation (F97-02, F97-03/A12/A14/B07)

**Files:** `T/application/FileRealProviderIntegrationTest.java`; use Task 1 harness, existing `realService(ObjectStorage)`, `recoveryWorker(ObjectStorage)`, real PG and direct authenticated provider fixture.

**Interfaces:** production `FileTransactions.registerAttempt/recordAttempt`, `FileRecoveryWorker.runCycle()`, existing File API. Capture key from committed attempt before releasing PUT. Use database time or explicitly backdate only test due deadlines with JDBC; do not change production 1h interval.

- [ ] Add `@RepeatedTest(3) latePutAfterDeleteWithLostAckRemainsUnknownAcrossRevisits`: prepare/transfer via combined gate, wait for committed PENDING locator and buffered PUT, request cleanup in owner transaction or expire and record durable fence. Run worker with direct provider. Assert actual DELETE ACK evidence (counting wrapper delegating to real S3), no object present, cleanup fence, UNKNOWN, null settlement/confirmation, exact retained key and next due approximately DB ACK + 1h. Release PUT, assert observed provider 200 then lost acknowledgement, transfer OUTCOME_UNKNOWN, independent GET matches exact bytes, no selected pointer. Before due run worker and verify no further DELETE; advance due, worker removes late bytes, retains key, no confirmation; another due cycle issues DELETE on absent key and still retains locator; parent non-PURGED, no extra network PUT, no File claim/read admitted.
- [ ] Extend `successfulProviderPutWithLostAcknowledgementRemainsUnknownAndUnselected` to prove unexpired selectable UNKNOWN with no winner is preserved, then expiry fence and worker cleanup/repeated hourly revisit; assert public EXPIRED and never PURGED while unresolved. Preserve existing settled late-PUT test and three repetitions; distinguish hazard observation from recovery success.
- [ ] Run `./mvnw test -Dtest=FileRealProviderIntegrationTest`. If new tests expose a production bug, make smallest approved-scope change and demonstrate RED/GREEN. If already passing, pin sensitivity to the relevant fence/revisit/confirmation guard; do not fake provider outcomes.
- [ ] Rerun focused real tests including existing late settled case, record independent runs and actual GET/DELETE/DB facts without raw keys/credentials. Commit `test(file): prove late unknown writes remain durably recoverable`.

### Task 3 — Complete real-provider recovery, crash, lease and winner fault matrix (F97-03)

**Files:** `T/application/FileRealProviderIntegrationTest.java`, `T/application/FileRealRestartIntegrationTest.java`, `T/application/FileRecoveryCompletionIntegrationTest.java`, `T/application/FileRecoveryLeaseIntegrationTest.java`, `T/application/FileTransferFailureIntegrationTest.java` as needed. Reuse existing `start(PostgreSQLContainer, Path, String)` for actual context restart and production S3 adapter. No new production behavior except defects proven by these tests.

**Interfaces:** `FileRecoveryTransactions.claimDelete(UUID,UUID): Optional<DeleteClaim>`, `completeDelete(DeleteClaim,DeleteCompletion): CompletionDisposition`, `recordExpiry(UUID): boolean`, `compactFile(UUID): boolean`, worker `runCycle()`; use two separate worker instances with real transactional collaborators, not two calls to the same local overlap guard. For barrier wrapper delegate all S3 methods to real storage; block AFTER DELETE ACK and before returning to first worker so its completion has not run.

- [ ] Add/extend real tests in bite-sized groups:
  
  | Test | Required assertions |
  |---|---|
  | `databaseCommitFailureAfterRealPutRecoversAfterRestart` | Actual PUT bytes independently verified; deferred DB commit failure leaves PENDING locator/no winner; stop app/provider, keep DB/volume; restart, expire parent via test deadline, actual worker DELETE removes bytes, UNKNOWN locator/identity retained, repeated due ACK stays unsettled. Pre-PUT registration rollback remains zero network PUT. |
  | `unsettledDeleteAckCrashReplaysWithoutConfirmation` | Durable unsettled lease and real DELETE ACK, context closes before completion (or forced DB rollback), restart after lease expiry, actual worker reclaims distinct token and repeats DELETE; key and null settlement/confirmation preserved even when absent. |
  | `staleWorkerCannotFinalizeAfterRealLeaseReclaim` | At least 3 independent repetitions; first worker blocks after real DELETE, test expires lease, second worker claims distinct token and deletes, first resumes; STALE disposition or committed facts unchanged, no locator rehydration/extra selection. Use settled and unsettled variants where relevant. |
  | `settlementAfterDeleteClaimNeedsFreshRealDelete` | Hold original PUT and first worker after DELETE ACK; release PUT and observe original authoritative completion while fenced; first unsettled-at-claim ACK cannot confirm; next due immediate; second real DELETE removes observed bytes and safely compacts. Repeat critical race 3 times. |
  | `losingPhysicalAttemptsCleanedWithoutTouchingClaimedWinner` | Extend existing real retry helper: one verified/claimed winner, distinct settled loser and UNKNOWN loser (e.g. lost ack); actual worker removes losers, settled loser compacted, UNKNOWN retained, exact winner pointer and authenticated File read bytes/size/digest unchanged, no DELETE for winner. |
  | `interruptedUpstreamPutIsTrackedAndReconciled` | A11: actual provider receives nonzero strict body prefix before upstream abort, real upload returns uncertain/settled only if authoritative, no exposed partial bytes, no selected pointer; expire/remove and worker reconciles observed object, retain UNKNOWN locator if unsettled. |
  | `providerRestartDuringPartialPutIsTrackedAndReconciled` | A13: stop/restart provider on same volume after observed upstream body barrier, no accessible partial bytes; inspect direct provider outcome, reconcile any observed object using actual worker, retain unresolved locator; no claim of finite proof from absent read. |
  | `settledRetryCompactsParentAndRejectsTerminalReplay` | Extend real outage/restart test: start from claimed file, logical removal commits, new read denied, real storage outage persists retry/error/locator; restart and retry after due, real absence and attempt terminal facts, subsequent worker poll parent PURGED with identity/scope/fingerprint preserved, same request replays same terminal ID, mismatched request/scope fails, transfer/claim/late record cannot write or reopen. |

- [ ] Run each group using `./mvnw test -Dtest=FileRealProviderIntegrationTest#methodName` or `FileRealRestartIntegrationTest#methodName` (use actual names for extensions). Verify observed fault, not merely failure caused by a test timeout. Use fresh DB assertions, independent GET, count delegated DELETE and PUT, check no active transaction during storage calls. Add focused regression for any discovered production defect; no unapproved semantic changes.
- [ ] A15 remains historical conditional-PUT hazard evidence (production uses unique keys, not conditional fencing). Document its production equivalent safety proof from Task 2/3; do not add conditional writes to production. If an explicit historical provider hazard reproduction is needed, exercise it only in disposable test fixture and mark as characterization, not a production protocol.
- [ ] Run `./mvnw test -Dtest=FileRealProviderIntegrationTest,FileRealRestartIntegrationTest,FileRecoveryCompletionIntegrationTest,FileRecoveryLeaseIntegrationTest,FileTransferFailureIntegrationTest`; expect zero failures/errors/skips. Record per-case barrier/order/actual effects, including repetitions. If provider cannot produce required barrier, escalate blocker. Commit `test(file): close real provider recovery and lease fault matrix`.

### Task 4 — Complete owner transaction/version surrogate (F97-04/B05/B06/B10)

**Files:** `T/application/TestFileOwner.java`, `T/application/FileOwnershipIntegrationTest.java`, `T/application/FileRecoveryWorkerIntegrationTest.java`; reuse `FileApplicationTestConfiguration.java`. For real-provider byte assertions reuse real fixture in Task 3 where appropriate. No real Note/Trash classes.

**Interfaces:** existing `TestFileOwner.inTransaction(Supplier<T>)`; test-only association and parent version/state rows in fixture schema. Use test-owned parent identity and version, explicit owner/binding check before calling File API. Keep fixture helper signatures local to tests; no public production method changes.

- [ ] Add `permanentParentDeletionContractQueuesAllAuthorizedFilesAtomically`: test parent with multiple claimed File associations and an authorized pending reservation containing an UNKNOWN attempt (model pending association separately; do not claim UNKNOWN). Sort File UUIDs before requestCleanup. Inject rollback after version/detach/cleanup; verify all associations/version/cleanup unchanged, claimed bytes readable, worker no DELETE. Test wrong user/workspace/binding rejects with no mutation. Commit valid parent removal transaction, version increments once, associations removed, all files inaccessible immediately; actual worker deletes settled objects, retains UNKNOWN key, does not touch unrelated parent/winner.
- [ ] Add `finalizeRollbackAndLostFinalizeResponseDoNotTriggerCleanup`: stale expected parent version or injected transaction failure leaves uploaded verified bytes and no claim/association/version mutation; valid finalize creates one association and increments version once. Simulate lost response after commit, replay only same owner/scope/parent/association returns existing association and version, not a second increment. Competing parent rejected (retain existing concurrent claim test). Worker leaves claimed selected object readable; mismatched replay denied.
- [ ] Add `rollbackRemovalAndTrashEquivalentRetainBytes`: archive, trash and restore update only test parent lifecycle facts and never call cleanup; run worker after each; assert same File ID/selected key/exact bytes, association retained. Rollback individual detach+version+cleanup leaves bytes intact; valid individual detach deletes only detached file asynchronously. Model File availability separately from owner route access (Trash may hide owner route without deleting File).
- [ ] Run `./mvnw test -Dtest=FileOwnershipIntegrationTest,FileRecoveryWorkerIntegrationTest,FileConcurrencyIntegrationTest`; validate fixture assertions are sensitive to missing rollback/version/scope checks. Keep owner surrogate distinct from production Note acceptance. Commit `test(file): verify atomic owner removal and finalize replay contracts`.

### Task 5 — Stop new recovery admission during graceful shutdown (F97-05)

**Files:** `F/application/FileRecoveryWorker.java`, `F/infrastructure/FileRecoverySchedulingConfiguration.java`, `T/application/FileRecoverySchedulerIntegrationTest.java`, `T/application/FileRecoveryWorkerIntegrationTest.java`.

**Interfaces:** proposed internal worker `public void stopAcceptingWork()`; `runCycle()` no-op once stopping; managed context-close signal invokes stop on actual worker before scheduler waits. Serialize stop and candidate transaction admission with a small private synchronization gate (never hold across S3); after stop linearizes, no new expiry/lease/compaction transaction or remote DELETE is started for a subsequent candidate. A claim already admitted before stop may complete safely or leave lease for restart; do not abandon key/clear lease manually. New application context starts with fresh guard. Existing constructor/API/one scheduler unchanged.

- [ ] Add `shutdownDuringDeleteStopsFurtherClaimsAndRestartResumes`: dedicated disposable app context with scheduler enabled, 2 eligible rows ordered, recording or delegating storage holds first DELETE on latch; trigger real context close on another thread, observe stop signal deterministically, release first; await close within bounded test budget, use separate DB connection/new context to assert second count/lease unchanged and no second DELETE. Restart with same DB and storage fixture; verify second completes and any unfinished lease recoverable. Ensure first may safely commit completion or stay durable, never fake ACK.
- [ ] Add `stopBeforePollPreventsAllCandidateAdmission` and `stopIsIdempotent` focused worker test(s); keep interruption and overlapping-cycle tests. Run `./mvnw test -Dtest=FileRecoveryWorkerIntegrationTest,FileRecoverySchedulerIntegrationTest`; expect failing regression before fix.
- [ ] Implement stop guard and context-close coordination in existing worker/scheduling configuration. Ensure listener is scoped to its owning application context, invoked before teardown of transaction/storage resources; avoid self-invocation of transactional boundaries. Check stop before poll/discovery and within admission gate around individual claim/expiry/compaction only. If stop arrives after a claim and before DELETE, leave durable lease for restart or finish that already-admitted item safely; never acquire next item. Do not hold admission lock over provider I/O. Guard stopping state from scheduler and manual calls, no global static flag. Preserve fixed-delay, one thread, disabled configuration behavior and no new scheduler dependency. If lifecycle ordering cannot guarantee this, stop for design review rather than pretend interruption is sufficient.
- [ ] Rerun focused tests, scheduler enable/disable regression, actual restart integration. Commit `fix(file): stop recovery work admission during context shutdown`.

### Task 6 — Validate PostgreSQL discovery, fairness, and diagnostics (F97-06 + CodeRabbit)

**Files:** `F/infrastructure/persistence/FileRecoveryPersistence.java`, `T/infrastructure/persistence/FileRecoveryPersistenceIntegrationTest.java`, `T/application/FileRecoveryLeaseIntegrationTest.java`, `T/infrastructure/FileRecoveryObservabilityTest.java`, runbook/report.

**Interfaces:** existing `findCandidates(WorkKind,Instant,int): List<Candidate>`, `recoveryCounts(Instant): RecoveryCounts`, WorkKind EXPIRE_FILE/DELETE_ATTEMPT/COMPACT_FILE. Extract shared SQL definitions internally only if needed to make EXPLAIN use exact production statement/parameters; no new public File endpoint. No offset scan or unbounded candidate list.

- [ ] Add parameterized held-oldest-parent tests for each work kind (limit 1), including worker cycle with locked head and another due row. Assert later due row is discovered/processed, locked row unchanged and eligible after release. Existing DELETE test only covers that kind; preserve it. Add `diagnosticsMatchDiscoveryWithoutCountingLiveWinner` with live claimed/unclaimed winner, selectable UNKNOWN, eligible settled/unknown loser, durable parent expiry/removal, future retry, active/expired lease, terminal tombstone; assert due counts match actual eligible discovery at fixed DB time (distinguish expiry awaiting durable fence from immediately claimable delete), no live winner due, same aggregate runbook semantics. Verify per-kind fairness at batch 1 and larger with locked/leased backlog.
- [ ] Run `./mvnw test -Dtest=FileRecoveryLeaseIntegrationTest,FileRecoveryObservabilityTest,FileRecoveryWorkerIntegrationTest`; repair actual defects only, preserve predicates/locks and safe metrics.
- [ ] Add representative opt-in PostgreSQL performance fixture/test in `FileRecoveryPersistenceIntegrationTest` or dedicated test class if warranted. Use disposable DB, realistic synthetic live, terminal, due, leased and unresolved populations, including substantially more than 25 candidates; record cardinalities and distributions (choose fixture sizes appropriate to available runner; no arbitrary latency SLA). Run ANALYZE then exact production queries via `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` with same time/limit/bindings for three kinds and aggregate. EXPLAIN ANALYZE of locking queries acquires locks: use isolated transaction and rollback; never run against deployment. Measure scanned/returned rows, sorts, buffer use, index selection and elapsed time. Capture evidence for small and larger UNKNOWN backlog and locked head, not hard-coded planner node assertions.
- [ ] Inspect actual plans; if evidence reveals material full scans/sorts or starvation, implement smallest index/query fix, prove before/after with identical fixture and semantic regression tests. New index requires forward migration and fresh/upgrade validation, no rewrite; ask human before material architectural/policy change. Aggregate scans may legitimately scale with retained history; quantify rather than guarantee constant time. Document limitations even if no change needed.
- [ ] Record results in validation report; update runbook query only if mismatch. Recheck both CodeRabbit findings against head, reply with exact tests/commit and resolve only if supported. No agent-dispatched review. Commit `test(file): validate recovery query plans and locked-head progress` (or appropriate minimal fix commit).

### Task 7 — Close R5 and update acceptance evidence (F97-01/F97-07)

**Files:** `docs/architecture/validation/ISSUE-77-FILE-RECOVERY-VALIDATION.md`, `docs/architecture/FILE-RECOVERY-RUNBOOK.md` as needed. Evidence from Tasks 0–6 and operator.

- [ ] Validate operator-provided actual target configuration and authenticated disposable PUT/read/delete/absence-of-versions evidence. Record date, provider/pin, sanitized scope, read-only configuration observations and test results without object keys, credentials or customer data. If missing, unsupported or incompatible, explicitly mark R5 BLOCKED; ask human/operator for needed evidence. Do not equate local provider tests with actual deployment. No silent waiver/deferral, no change to bucket settings or permissions, no claim of backup erasure.
- [ ] Correct report baseline master `d2c11bf...`, handoff `4b94f2c...`, actual implementation and verification SHAs, PR #97 and prior CI run. Remove stale claims no PR exists. Report actual master Spring Boot 4.0.10, local Playwright install limitation honestly (hosted install passed), test counts, Docker/provider versions, query plans, race repetitions, Sonar findings and scoped dispositions. Explain that unresolved DELETE ACK never confirms physical settlement. Mark later CI pending until actual latest run.
- [ ] Include these individual proof rows with exact test names, run IDs/commit, actual result and any gap (do not mark a row closed merely because a test exists):

  | POC input | Required production proof / owner |
  |---|---|
  | A11 | Actual upstream interruption after observed partial-body barrier — Task 3 |
  | A12 | Provider success observed and response lost — Tasks 1–2 |
  | A13 | Provider restart during held partial write — Task 3 |
  | A14 | Late object actually visible after DELETE, then worker recovers — Tasks 2–3 |
  | A15 | Historical conditional-write hazard; production distinct-key + late-write recovery proof, no conditional fence claim — Tasks 2–3 |
  | B01 | Durable intent/lease/locator survives real restart — Task 3 |
  | B02 | Real PUT + DB commit rollback, unassociated bytes removed, UNKNOWN retained — Task 3 |
  | B03 | Same logical idempotency identity; new physical key per new network PUT, not reuse of POC attempt — Tasks 2–3 and existing prepare/transfer tests |
  | B04 | Fingerprint/scope mismatch and terminal non-resurrection — Task 3 |
  | B05 | Stale owner version/rollback retains staged bytes — Task 4 |
  | B06 | Competing claims, one valid association/live winner — Tasks 3–4 |
  | B07 | Unsettled late object tracked across absent check/DELETE and later cleanup, indefinite locator — Tasks 2–3 |
  | B08 | Real storage outage/restart retries committed logical removal — Task 3 |
  | B09 | Confirmed settled deletion retains tombstone, rejects retry resurrection — Task 3 |
  | B10 | Lost finalize response, same association/version replay — Task 4 |

  Add separate rows for every #77 acceptance criterion and D77-01–08/R1–R6; clearly mark owner surrogate vs actual future Note integration. Include F97-01–07 disposition, code/test/commit links and R5 gate state.
- [ ] Commit `docs(file): record PR 97 remediation and acceptance evidence`. Documentation is not proof of execution; no checkbox marked without observed evidence.

### Task 8 — Full local and hosted verification, same-PR handoff (all findings)

**Files:** report and PR comment only after actual tests; no CI configuration modification.

- [ ] Review complete diff inline against pinned spec, plan and review. Confirm no new production APIs/PRDs, no scope creep, no weakened tests or migration rewrite, no privacy-sensitive log fields, no S3 in DB tx, correct claim/lease/settlement/tombstone behavior. Run `git diff --check` and clean checkout check.
- [ ] From `server/`, run `./mvnw spotless:check`, `./mvnw test`, `./mvnw verify`, and CI-equivalent `./mvnw -B -ntp verify dependency:build-classpath -DincludeScope=test -Dmdep.outputFile=target/sonar-test-classpath.txt`. Confirm all exit 0, Docker/real tests executed, Surefire zero failures/errors/skips, SpotBugs and JaCoCo checks, nonempty classpath/coverage XML/classes. Record actual counts and commands.
- [ ] From `client/`, Node 24: `npm ci --legacy-peer-deps --ignore-scripts`, `npm run verify`, confirm coverage/lcov.info, `npm run test:e2e:install`, `npm run test:e2e`. Do not misstate local install failures; resolve environment issue if authorized, otherwise document blocker. Run all applicable CI equivalents even if no frontend changed.
- [ ] Commit remaining verified changes and push normal fast-forward updates to `feature/77-file-recovery`. This updates PR #97; do not create another PR. Inspect actual GitHub Actions and check-runs for current head/merge-test revision: backend, frontend, Playwright, sonarcloud, SonarCloud Code Analysis/quality gate, all additional applicable required checks. Verify latest head SHA, success conclusions and run URLs. Explicitly account for CodeRabbit skipped if not required; do not label it passed. If any required check skipped/failed/pending, investigate and fix inline, push to same PR and repeat. Never bypass checks.
- [ ] Post a disposition comment on PR #97 with each F97-01–07, status/evidence/commit/test IDs, current CI run links and R5 evidence or explicit blocker. To avoid a self-referential report/commit loop, record verified implementation SHA and CI links as evidence in PR comment for final docs-inclusive head; if another report commit is pushed, verify its new CI too. No reliance on a previous SHA's green checks.
- [ ] **Final review gate:** all findings resolved, actual R5 evidence accepted, all applicable required CI checks green on latest SHA, no outstanding blockers or unapproved decisions. Only then request human final review. If R5 remains blocked, report code/test progress and CI without requesting final review or merge. No automatic merge/issue closure.

## Plan self-review

Every review finding maps to a task and executable acceptance evidence: F97-01 → 0/7/8; F97-02 → 1/2; F97-03 → 1/2/3; F97-04 → 4; F97-05 → 5; F97-06 → 6; F97-07 → 0/6/7/8. The five review-focus cases are pinned to tests. Proposed internal fixture names and shutdown admission gate implement the existing review, not new product decisions; raise material alternatives for human approval. No additional scope, provider upgrade, CI bypass or R5 exception. This plan is a correction overlay on the original approved plan, not a replacement. The human authorized corrective work and publication; review this plan before beginning execution. No tests have been run or fixes made during plan authoring.
