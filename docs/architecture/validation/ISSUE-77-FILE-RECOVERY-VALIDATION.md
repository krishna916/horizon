# Issue #77 File recovery validation

This report records implementation and local verification for the approved
Issue #77 recovery plan and its PR #97 review remediation. The implementation
is based on `master` baseline `d2c11bf64b7af1420d840e71b4b90c267cc85654` and
the recovery commits through `2fe3a9403f2c610f4c7c8ba765b4cafdcab42c09` on
`feature/77-file-recovery`. PR #97 is open. Its remediation-plan commit is
`1d0d584321806c5cd863bc9ff63c165ef38de618`; local verification and review
remediation results will be appended against the final remediation commit.

## Scope and behavior

The File module now has durable, bounded recovery work for expiry, attempt
cleanup, and tombstone compaction. PostgreSQL discovery uses indexed due-time
queries and small bounded batches. Each candidate is claimed under the
existing file/attempt lock order, with expiring fencing leases and fresh
database-clock timestamps. Provider DELETE runs outside database
transactions. Retries persist bounded error codes and backoff deadlines;
UNKNOWN PUTs retain their unique object key until a DELETE acknowledgement is
durable and late writes are revisited. Parent metadata is compacted only when
every attempt locator and retained descriptor is cleared.

No File endpoint, File API, Note lifecycle, Task status model, generic work
table, or Trash callback was added. File has no Note dependency. The worker
does not promise immediate deletion, backup erasure, or a finite cleanup time
for UNKNOWN writes.

## Verification evidence

Environment: Java 25.0.4, Maven wrapper, Docker 29.9.2, PostgreSQL 17.11,
Node 24.21.0, npm 11.19.0. Spring Boot remains at 4.0.10 per the approved
implementation decision. Real provider checks used the exact pinned image
`ghcr.io/chrislusf/seaweedfs:4.54@sha256:e7d4b80af9bd49b2630a60ac6fbb7ffb620ac6a2c501f689c22a71b9f89f0203`.

| Command | Result |
| --- | --- |
| `server/./mvnw -Duser.timezone=UTC test` | Passed: 532 tests, 0 failures, 0 errors, 0 skipped. |
| `server/./mvnw -B -ntp verify dependency:build-classpath -DincludeScope=test -Dmdep.outputFile=target/sonar-test-classpath.txt` | Passed: same 532 tests; SpotBugs 0 findings; JaCoCo XML validation passed; classpath generated. JaCoCo XML, classpath, and compiled main/test classes are nonempty/present. |
| `client/npm ci --legacy-peer-deps --ignore-scripts` | Passed. |
| `client/npm run verify` | Passed: ESLint (3 existing warnings, 0 errors), Prettier, Vitest coverage, production build, and coverage assertions. `coverage/lcov.info` is nonempty and measured. |
| `client/npm run test:e2e:install` | Could not install OS dependencies because the script invokes `sudo`, which this container disallows (`no new privileges`). Playwright Chromium was already installed in the environment. |
| `client/npm run test:e2e` with local loopback binding allowed | Passed: 105 Playwright tests. The sandbox initially denied Vite's `127.0.0.1:5173` bind; the same command passed after the required local-network sandbox escalation. |
| `git diff --check` | Passed. |

The failed first backend full-test run reported one error because the new
unversioned-bucket assertion queried a bucket before creating it. The test now
creates the bucket first; the focused S3 suite passed 8/8 and both subsequent
full backend runs passed 532/532.

### PR #97 remediation baseline (2026-11-28, head `1d0d584`)

The working checkout matched `origin/feature/77-file-recovery` at
`1d0d584321806c5cd863bc9ff63c165ef38de618`, with `origin/master` at the stated
base. The baseline ran before remediation edits:

| Command | Result |
| --- | --- |
| `./mvnw -Duser.timezone=UTC test -Dtest=FileRealProviderIntegrationTest,S3ObjectStorageIntegrationTest` | Passed: 14 tests, 0 failures, 0 errors, 0 skipped. |
| `./mvnw -Duser.timezone=UTC test` | Passed: 532 tests, 0 failures, 0 errors, 0 skipped. |
| `./mvnw -Duser.timezone=UTC verify` | Passed: 532 tests, SpotBugs 0 findings, JaCoCo XML validation passed. |

Toolchain and isolation observed: Java 25.0.4, Node 24.21.0, npm 11.19.0,
Testcontainers with PostgreSQL 17.11, and per-test temporary SeaweedFS 4.54
storage pinned to digest
`sha256:e7d4b80af9bd49b2630a60ac6fbb7ffb620ac6a2c501f689c22a71b9f89f0203`.
These runs establish the baseline only; they do not verify remediation changes
or the actual deployment bucket.

### PostgreSQL discovery and diagnostics (Task 6)

The focused recovery matrix passed on PostgreSQL 17.11: `FileRecoveryLeaseIntegrationTest`,
`FileRecoveryObservabilityTest`, and `FileRecoveryWorkerIntegrationTest` ran
32 tests with zero failures, errors, or skips. The oldest-parent lock test uses
batch size 1 for expiry, deletion, and compaction. For each kind, a later due
row was processed while the oldest parent was held; the locked row remained
unchanged and became eligible after release. A temporary removal of
`SKIP LOCKED` made the expiry case fail by returning the blocked oldest row;
the production clause was restored before the final run.

The diagnostics parity case includes a live selected winner, a selectable
unsettled attempt, a settled failed attempt, a parent-fenced UNKNOWN attempt,
an expired-but-not-yet-fenced parent, future retry, active and expired leases,
and a compactable terminal parent. At a fixed database timestamp, the
diagnostic due count equaled the sum of candidate discovery for all three work
kinds. It excluded the live winner, future retry, active lease, and unfenced
expiry from deletion eligibility while reporting the expiry as expiry work.
Unresolved and lease counts matched the fixture.

An opt-in Testcontainers fixture ran the exact production SQL via
`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` inside rollback-only transactions.
Command: `./mvnw -Duser.timezone=UTC -Dfile.recovery.explain=true test
-Dtest=FileRecoveryPersistenceIntegrationTest#explainsProductionQueriesAgainstRepresentativeRecoveryBacklogs`.
It loaded 2,000 due expiry parents and 64 terminal compaction parents, then
measured both 128 and 5,128 UNKNOWN attempts (the initial backlog also had 32
active leases and 32 future retries). At the larger population, expiry used
`idx_file_metadata_expiry` and completed in 1.021 ms; compaction used
`idx_file_recovery_parent_terminal` and completed in 0.107 ms. DELETE discovery
returned its bounded 25 rows after scanning about 7,192 parent rows and 5,064
attempt rows and sorting the due candidates; it completed in 11.462 ms. The
diagnostic aggregate scanned retained rows and completed in 15.589 ms. With the
oldest expiry parent separately locked, the production query still returned 25
later rows and completed in 1.204 ms. At the smaller backlog, the four query
times were 0.059 ms (expiry), 1.156 ms (delete), 0.094 ms (compaction), and
1.632 ms (diagnostics).

No query or index change was justified by these fixture timings. DELETE and
aggregate work scan history and will scale with retained rows; these synthetic
measurements are not a production capacity guarantee. Larger deployment data
should be measured before changing indexes or query shape. The runbook's
attempt diagnostic predicates match the worker's live-winner, retry, lease,
and cleanup eligibility rules; no query correction was needed there.

## Recovery and provider proof

- PostgreSQL integration coverage verifies migration on empty databases and
  persistence across actual application restarts. The real application and
  SeaweedFS are stopped and restarted against the same database and object
  volume; recovery reclaims an expired lease, replays DELETE idempotently,
  completes cleanup after a provider outage, and preserves an unsettled
  locator until it can be revisited.
- Real SeaweedFS integration coverage uses the production S3 adapter. It
  checks that the bucket starts unversioned, writes and reads an object,
  deletes it, observes the object missing, and finds no object version or
  delete marker. An existing provider test also verifies unsigned reads are
  denied. The late-PUT fault test is repeated three times: a real recovery
  worker deletes before the held PUT completes, records the acknowledgement
  as uncertain because the write was unsettled at claim time, retains the
  locator, then deletes the late object after PUT settlement and confirms
  cleanup.
- Scheduler, database-clock, lock/lease, retry and observability integration
  suites pass in the full Maven run. Metrics use bounded error/outcome tags;
  tests check that owner/file/key/error text is not logged or exported and
  recovery adds no public management endpoint.
- The #75 POC cases A11–A15 and B01–B10 are treated as fault scenarios and
  acceptance prompts, not production proof. This branch's actual worker,
  PostgreSQL lease/locator persistence, restart test, and real-provider late
  PUT test provide the production-path evidence listed above. No POC-only
  simulation is represented as proof of deployment configuration.

## Acceptance and review traceability

Status is against the full local test run after the Task 7 A13/B09 follow-up.
Backend verification passed 552 tests (zero failures/errors, one existing skip),
SpotBugs, and coverage validation. Client verification passed 738 unit tests,
coverage checks, build, and the 105-test Playwright suite. Hosted CI evidence for
the final pushed head is still pending. Real-provider results use pinned
SeaweedFS 4.54 Testcontainers; the owner integration is a test-only surrogate
and does not establish Note route or transaction behavior.

### Issue #77 acceptance criteria

| Acceptance criterion | Evidence and status |
| --- | --- |
| Failed/restarted cleanup keeps known-object intent | **Pass:** `FileRealRestartIntegrationTest.realApplicationRestartRetainsDatabaseAndObjectVolume` exercises durable locator/lease state across app and provider restart; `FileRecoveryCompletionIntegrationTest.failureAfterSuccessfulDeleteBeforeCommitLeavesLeaseAndLocator` covers a failed completion commit. |
| Removal becomes inaccessible when logical deletion commits; physical cleanup retries | **File path pass; Note route deferred:** `FileOwnerContractIntegrationTest.permanentParentRemovalIsAtomicAndRetainsUnknownAttemptLocator` proves surrogate transaction behavior, rollback, denial and async cleanup. Actual Note owner route remains downstream scope (#78/#79/Epic #9). |
| Incomplete upload cleanup does not delete live associations | **Pass for File:** `FileRealProviderIntegrationTest.interruptedTrackedPutRemainsUnknownAfterRealProviderDelete`, `latePutAfterDeleteWithLostAckRemainsUnknownAcrossRevisits`, and `FileOwnerContractIntegrationTest.finalizeReplayAndArchiveTrashSurrogatePreserveVersionAndBytes` cover unresolved writes, selected-winner safety and owner-surrogate associations. Actual Note association integration remains deferred. |
| Concurrency, idempotency and transient storage failures are tested | **Pass:** `FileRealProviderIntegrationTest.staleWorkerCannotFinalizeAfterRealLeaseReclaim` (3 repetitions), `lateProviderPutAfterCleanupIsDiscoverableAndRetryUsesDistinctKeys` (3 repetitions), `FileRecoveryWorkerIntegrationTest.storageFailureSchedulesRetryWithoutHotLoop`, and `FileTransferFailureIntegrationTest.retryUsesDifferentKeyAndFirstVerifiedCommitWins`. |

### Required #77 implementation details and D77-01–08 / R1–R6

| Requirement | Evidence and status |
| --- | --- |
| PostgreSQL is the durable queue; one managed scheduler survives restart (D77-01, R3) | **Pass:** durable File tables and scheduled single worker; `FileRealRestartIntegrationTest.realApplicationRestartRetainsDatabaseAndObjectVolume`. Task 5 shutdown admission test proves no second item is admitted after `ContextClosedEvent`. |
| Short locked transactions, lease and unique fencing token (D77-02, R3) | **Pass:** `FileRecoveryLeaseIntegrationTest.twoConcurrentClaimersOnlyOneValidLease`, `expiredLeaseReclaimedWithDifferentToken`, and `FileRealProviderIntegrationTest.staleWorkerCannotFinalizeAfterRealLeaseReclaim` (3 repetitions). |
| 30s poll, batch 25, 10m lease, jitter retry 30s–1h, hourly UNKNOWN revisit, unlimited attempts (D77-03, R4) | **Pass locally:** configuration defaults and validation in `FilePropertiesTest`; `FileRecoveryWorkerIntegrationTest.cycleProcessesAtMostConfiguredBatch`, `rotatingKindsAvoidStarvationUnderUnknownBacklog`, `storageFailureSchedulesRetryWithoutHotLoop`; `FileRecoveryCompletionIntegrationTest.ackUnsettledReschedulesOneHourWithoutConfirmation` and `failedDeletePersistsRetryAndClearsLease`. Real lost-ACK schedule is asserted in `latePutAfterDeleteWithLostAckRemainsUnknownAcrossRevisits`. |
| UNKNOWN is never promoted; retries use new physical keys (D77-04, R2/R4) | **Pass:** `FileRealProviderIntegrationTest.latePutAfterDeleteWithLostAckRemainsUnknownAcrossRevisits` and `lateProviderPutAfterCleanupIsDiscoverableAndRetryUsesDistinctKeys`; no timeout, HEAD/GET absence, DELETE ACK or lease expiry settles an unsettled PUT. |
| Keep identity/fingerprints and minimal tombstones until safe terminal cleanup (D77-05, R6) | **Pass in File tests:** `FileRecoveryCompletionIntegrationTest.unknownRetainsDescriptorAndSelectedFkUntilAllAttemptsConfirmed`, `FileTransferFailureIntegrationTest.compactedAttemptCannotRestoreLocatorOrDigest`, and owner-surrogate permanent removal/replay tests. |
| Expiry remains EXPIRED, durably fenced before cleanup (D77-06, R1) | **Pass:** `FileRecoveryEligibilityIntegrationTest.expiryAtBoundaryDeniesClaimEvenAfterWaitedLock`, `clockRollbackCannotBackdateParentCompaction`, `FileTransferFailureIntegrationTest.recordedExpirySurvivesClockRollbackAndDeniesRegistration`, plus real unclaimed expiry/reconciliation tests. |
| Restricted diagnostics, safe tags, runbook, no public retry endpoint (D77-07, R6) | **Pass:** `FileRecoveryObservabilityTest.noSensitiveTagsOrRawExceptionMessage`, `countsMatchDueDiscoveryAndPendingUnknown`, `diagnosticsMatchDiscoveryWithoutCountingLiveWinner`, and `diagnosticsDoNotExposeAdditionalPublicEndpoint`; Task 6 PostgreSQL plan evidence is above. |
| Cleanup intent shares the owning mutation transaction (D77-08) | **File API pass; Note owner deferred:** `FileOwnershipIntegrationTest.cleanupAndCallerDetachRollbackTogether` and `FileOwnerContractIntegrationTest.permanentParentRemovalIsAtomicAndRetainsUnknownAttemptLocator` prove rollback/commit with test-only owner transactions. No File→Note call or S3 I/O inside owner transaction. |
| R1 expiry fence / authoritative time | **Pass:** durable expiry fact, clock rollback and lock-wait boundary tests above. |
| R2 irreversible attempt fence / settlement | **Pass:** `FileRecoveryCompletionIntegrationTest.ackUnsettledReschedulesOneHourWithoutConfirmation`, `settlementRecordedAfterClaimRequiresFreshDelete`, and real late-writer tests. |
| R3 exact bounded fair queue / one-at-a-time lease | **Pass:** worker batch/rotation tests and Task 6 all-work-kind locked-head matrix (batch 1); actual restart and stale-token tests above. |
| R4 capped equal-jitter retry / fresh DELETE after settlement | **Pass locally:** `FileRecoveryBackoffTest`, completion retry tests and `settlementRecordedAfterClaimRequiresFreshDelete`; real provider race proves a later actual DELETE removes late bytes. |
| R5 private, non-retaining deployment bucket | **BLOCKED:** only pinned local SeaweedFS behavior is verified. No deployment manifest, target bucket evidence or authorized disposable operation has been provided. No production bucket was accessed. |
| R6 metrics and no-attempt/mixed-attempt compaction | **Pass locally:** observability tests and `FileOwnerContractIntegrationTest.permanentParentRemovalIsAtomicAndRetainsUnknownAttemptLocator`; `FileRecoveryCompletionIntegrationTest.expiredNoAttemptParentPurges` covers no-attempt compaction. |

### #75 production fault inputs A11–A15 and B01–B10

| Input | Production-path evidence and remaining gap |
| --- | --- |
| A11 partial/interrupted PUT | **Pass:** `FileRealProviderIntegrationTest.interruptedPutForwardsPrefixBeforeAbortingUpstream` proves a nonzero forwarded prefix; `interruptedTrackedPutRemainsUnknownAfterRealProviderDelete` uses the real provider/worker and retains an unresolved locator after DELETE. |
| A12 successful PUT response lost | **Pass:** `heldPutCanBeCommittedByProviderThenItsSuccessfulResponseLost`; combined late PUT + lost acknowledgement is repeated 3 times by `latePutAfterDeleteWithLostAckRemainsUnknownAcrossRevisits`. |
| A13 provider restart during held partial PUT | **Pass:** `FileRealProviderIntegrationTest.providerRestartDuringHeldPartialPutRetainsUnknownLocatorAndReconciles` holds a real partial PUT, restarts SeaweedFS on the same volume, then reconciles through a fresh provider connection. It proves the sentinel survived the restart, the attempt remains UNKNOWN with the exact locator and no settlement/confirmation, no selected file becomes accessible, and worker DELETE removes any partial object whether it survived restart or not. |
| A14 late object after DELETE | **Pass:** `latePutAfterDeleteWithLostAckRemainsUnknownAcrossRevisits` (3 repetitions) independently observes the late bytes and actual worker DELETE/revisit. `lateProviderPutAfterCleanupIsDiscoverableAndRetryUsesDistinctKeys` also repeats the late-provider retry race 3 times. |
| A15 conditional-PUT hazard | **Production equivalent covered; historical reproduction not repeated:** every transfer has a distinct committed attempt key, and the A12/A14 late-writer races prove reconciliation. No conditional-PUT production fencing or claim that conditional writes solve late PUT after DELETE. |
| B01 durable intent/lease/locator across restart | **Pass:** `FileRealRestartIntegrationTest.realApplicationRestartRetainsDatabaseAndObjectVolume`. |
| B02 actual PUT then DB commit failure | **Pass:** `realApplicationRestartRetainsDatabaseAndObjectVolume` injects the post-PUT DB commit failure, verifies provider bytes and recovers the committed attempt locator after restart. |
| B03 logical idempotency with new physical key per PUT | **Pass:** `FileTransferFailureIntegrationTest.retryUsesDifferentKeyAndFirstVerifiedCommitWins` and real-provider `lateProviderPutAfterCleanupIsDiscoverableAndRetryUsesDistinctKeys`. |
| B04 scope/fingerprint mismatch and terminal non-resurrection | **Pass in File tests:** `FileOwnershipIntegrationTest.unverifiedExpiredUnclaimedAndWrongScopeCannotRead`, `FileTransferIntegrationTest.expiredFileCannotBeClaimedAndScopeMismatchCannotRead`, and `FileTransferFailureIntegrationTest.compactedAttemptCannotRestoreLocatorOrDigest`. |
| B05 stale owner version/rollback | **Surrogate proof:** `FileOwnerContractIntegrationTest.permanentParentRemovalIsAtomicAndRetainsUnknownAttemptLocator` proves stale-version rejection/rollback preserves association and staged bytes; actual Note version integration remains downstream. |
| B06 competing claims and live winner | **Pass:** `FileRealProviderIntegrationTest.lateProviderPutAfterCleanupIsDiscoverableAndRetryUsesDistinctKeys` and `FileOwnerContractIntegrationTest.finalizeReplayAndArchiveTrashSurrogatePreserveVersionAndBytes`; the owner mutation itself is a surrogate. |
| B07 indefinite UNKNOWN locator | **Pass:** repeated A12/A14 real-provider test retains the exact committed locator with null settlement/confirmation across absent checks and DELETE ACKs. |
| B08 outage/restart retry | **Pass:** `FileRealRestartIntegrationTest.realApplicationRestartRetainsDatabaseAndObjectVolume` restarts with the same DB/object volume and resumes cleanup. |
| B09 settled deletion tombstone/replay | **Pass:** `FileRealProviderIntegrationTest.realProviderSettledDeleteCompactionAndLateFinalizeReplayKeepTombstone` combines a settled real-provider PUT and DELETE, recovery compaction, and a late verified completion replay. The object remains absent, its attempt stays cleanup-confirmed with locator/digests cleared, and the parent remains purged with no selected attempt. |
| B10 lost finalize response/replay | **Surrogate proof:** `FileOwnerContractIntegrationTest.finalizeReplayAndArchiveTrashSurrogatePreserveVersionAndBytes`; actual Note finalize endpoint is downstream. |

### F97 review findings

| Finding | Disposition |
| --- | --- |
| F97-01 R5 deployment evidence | **Blocked** pending operator evidence; no waiver. |
| F97-02 late PUT + lost ACK | **Addressed:** Tasks 1–2; commit `d68ba37`; real provider success, lost response, late object, hourly revisit, repeated 3 times. |
| F97-03 real provider/restart/lease matrix | **Addressed:** Tasks 1–3 plus Task 7 follow-up tests; A13 restart-during-partial-PUT and B09 settled-delete/compaction/replay now have dedicated real-provider coverage. |
| F97-04 owner mutation surrogate | **Addressed as authorized:** Task 4, commit `54120a1`; actual Note integration remains downstream. |
| F97-05 shutdown admission | **Addressed:** Task 5, commit `99d5c95`; current context-close event test drives the owning event directly because Spring's test-managed context cannot be manually closed in-method. |
| F97-06 diagnostics/fairness/query plans | **Addressed:** Task 6, commit `02e40af`; 32-test matrix plus opt-in PostgreSQL 17 EXPLAIN fixture, no unjustified index/schema change. |
| F97-07 stale validation report | **Addressed locally:** this matrix corrects the baseline, records evidence/gaps, and includes full local backend, client, and Playwright verification. Hosted CI for the final pushed head remains pending. |

## Deployment gate and limitations

Repository inspection found local Compose and test configuration but no
production deployment manifest or authenticated production bucket access.
The local provider fixture proves the pinned SeaweedFS behavior only. It does
not prove that the actual deployment bucket is private, has never been
versioned, has Object Lock/retention disabled, or has no replication/provider
policy that retains deleted data. Nor can the repository test verify the
separately operated deployment's bootstrap credentials and health checks.
Those are R5 release prerequisites. They remain unknown, so the implementation
must not be approved for merge or deployment until an operator supplies
read-only configuration evidence and completes an authenticated disposable
object write/read/delete check against the actual bucket.

PR #97 is the existing review vehicle. A deployment evidence request was
posted there as comment `7239547131`; it asks the operator for sanitized
configuration evidence and the results of an authorized disposable-object
check. No actual deployment bucket has been accessed or mutated by this
verification. The request remains unanswered as of this report update.
R5 remains BLOCKED/OPEN pending that operator evidence. The branch's
Actions workflow runs backend, frontend, Playwright and SonarCloud for pull
requests targeting `master`; hosted checks must be checked against the final
remediation head and are not established by this historical report.

UNKNOWN writes can remain unresolved indefinitely if a provider keeps
accepting late writes or cannot provide a conclusive outcome. Their key and
minimal recovery identity are deliberately retained; there is no finite
UNKNOWN retention or erasure guarantee. This worker does not integrate with
Trash. Issue #78, Issue #79, and Epic #9 remain responsible for Note UI/routes,
duplicate inline references, and parent permanent-deletion integration.

See [the File recovery runbook](../FILE-RECOVERY-RUNBOOK.md) for operator
signals, database inspection, retry behavior, and escalation guidance.
