# Issue #75 S3 compatibility POC report

## Scope and status

This is a standalone proof harness only. It changes no production File/Note code, migrations, application database, main Maven project, or normal Compose file. Issue #75 remains open; draft File ADR PR #93 remains unaccepted. The Layer B recovery model is approved only for this disposable proof. **Production recovery strategy remains pending.**

The original harness was recovered from the working checkout and is now committed on PR #94. The clean-checkout run used commit `52b1b1b9e806080174614d97e777c6c2c524896a` from branch `poc/75-s3-compatibility`, cloned after the harness and volume-isolation commits. The clone was clean before running. No previously ignored `target/` output was copied into it.

## Clean-checkout verification

Run from `server/`, using a new `.env` with a unique `POC_S3_VOLUME`:

```bash
docker compose -f poc/s3-compat/compose.yaml up -d seaweedfs
./mvnw -f poc/s3-compat/pom.xml test
for attempt in 1 2 3 4; do
  ./mvnw -f poc/s3-compat/pom.xml -Dtest=S3FailureTest test
done
docker compose -f poc/s3-compat/compose.yaml down
```

The full suite ran **29 JUnit test methods: 29 passed, 0 failed, 0 errors, 0 skipped**. Four serial repetitions of `S3FailureTest` each ran six methods with no test failures, adding 24 method executions. The complete plus repeated runs therefore contain 53 test-method executions, not 53 unique tests. The fault suite repeated A14 five times total and A15 for 25 controlled interleavings total.

Across the five A14 barriers, the direct DELETE returned HTTP 204 before the PUT body was released. Four PUTs completed and the independent direct GET found the complete 2 MiB payload after DELETE. One PUT hit the SDK's single-attempt 5-second timeout and the follow-up GET was absent. **The A14 late-object hazard reproduced in 4/5 attempts.**

Across the 25 A15 conditional PUT/DELETE trials, 20 PUTs completed and the independent GET found the complete payload after DELETE. Five PUT attempts timed out; their follow-up GETs were absent. No partial payload was observed. **The A15 late-object hazard reproduced in 20/25 attempts.** These absent reads after timeout do not prove that a still-running remote write cannot commit later.

A12's gate observed provider HTTP 200 after the full PUT, dropped the client response, and the independent client read back byte-identical content. B07 retained its durable `UNKNOWN` attempt after an early absent HEAD, then a reconstructed coordinator found and deleted the exercised late write. The B07 test deliberately retained the locator/tombstone: it does not prove a finite safe retirement rule.

The clean run used a new named volume, `horizon-issue75-s3-compat-clean-20261122`, confirmed by Compose config and Docker volume inspection. Compose emitted a warning about the older `horizon-issue75-s3-compat-data` volume; it left that old volume untouched. The clean-run service was stopped with `docker compose down` after evidence capture; its dedicated volume remains for review. No `down -v` was run.

Sanitized per-case observations, object keys, run IDs, checksums where recorded, and PostgreSQL facts are in [`observations.md`](observations.md). The clean-run IDs are grouped by test class below; A14/A15 repeat IDs are listed in full.

## Environment and pinned inputs

| Component | Clean-run value |
|---|---|
| PR branch commit | `52b1b1b9e806080174614d97e777c6c2c524896a` |
| Host | Ubuntu 26.04.1 LTS, Linux x86_64 / `linux/amd64` |
| Docker Engine / Compose | 29.9.2 / 5.6.1 |
| Java / Maven | Temurin 25.0.4 / Maven 3.9.16 |
| AWS SDK for Java v2 | 2.59.2 |
| Testcontainers for Java | 2.0.5 |
| JUnit Jupiter / pgJDBC | 5.14.3 / 42.7.14 |
| SeaweedFS | 4.54, `ghcr.io/chrislusf/seaweedfs:4.54@sha256:e7d4b80af9bd49b2630a60ac6fbb7ffb620ac6a2c501f689c22a71b9f89f0203` (linux/amd64 child; release index `sha256:4b42c212543a0acd4c0e675215ecdcaf62a186ef98def76c7e12701871222d15`) |
| Toxiproxy | 2.13.0, `ghcr.io/shopify/toxiproxy:2.13.0@sha256:5d3dae09bc185dcc5ff6cf43abf6062a4a720aff0c4306a471e773acdcd107aa` (linux/amd64) |
| PostgreSQL test container | `postgres:17@sha256:9d4105e2fcb1308961d4ee01f0ebc14fdd0497b11243982a4a0935fdb1a8f8dc` (linux/amd64; PostgreSQL 17.12) |
| Testcontainers Ryuk helper | Testcontainers-managed `testcontainers/ryuk:0.14.0`, observed manifest `sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0` (linux/amd64); selected transitively by Testcontainers 2.0.5, not explicitly configured in this POC |

The AWS SDK, Testcontainers, SeaweedFS, Toxiproxy, PostgreSQL, and pgJDBC versions match the approved POC pins. The SeaweedFS digest is the corrected runnable image. Ryuk is an auxiliary image selected by the pinned Testcontainers release; its runtime version and digest are recorded above.

The environment uses explicit test-only credentials, a private bucket, path-style requests, an independent direct S3 client, disabled AWS SDK retries, loopback-only SeaweedFS port 8333, and disposable Testcontainers PostgreSQL. The proof never connects to Horizon's application database or a live object store. Compose storage is isolated from the previous named volume.

## Case ledger

“Test execution” reports the JUnit outcome. “Architecture conclusion” states what the evidence supports; a passing hazard-detection test is not a safety guarantee.

| Case | Test source | Evidence run ID | Test execution | Architecture conclusion |
|---|---|---|---|---|
| A01 | `S3BasicCompatibilityTest.A01_credentialedClientSeesBootstrappedPrivateBucket` | `36fbd43b-825f-4cf4-beea-a2a3e9186fe0` | PASS | Authenticated bucket access compatible |
| A02 | `S3BasicCompatibilityTest.A02_wrongCredentialsAndUnsignedReadAreRejected` | `36fbd43b-825f-4cf4-beea-a2a3e9186fe0` | PASS | Invalid credentials and unsigned read rejected |
| A03 | `S3BasicCompatibilityTest.A03_putHeadAndGetPreserveExactBytesAndSha256` | `36fbd43b-825f-4cf4-beea-a2a3e9186fe0` | PASS | Provider round trip compatible; 4,097 bytes, SHA-256 `bd1148f3f6d84f7da976665e6ca110a60b54e9fbc784436d2e70549d3970ebd9` |
| A04 | `UploadValidationPolicyTest.A04_acceptsTheMaximumAndRejectsOversizeUnknownAndMismatchedLengthsBeforePut` | `207c2397-8173-4436-8e5d-154fe5c3bcb5` | PASS | Test-only upload policy accepted 20,971,519 bytes and rejected oversize, unknown, and mismatched lengths before PUT |
| A05 | `UploadValidationPolicyTest.A05_mutatedBoundedTempFileFailsSha256ValidationBeforePut` | `207c2397-8173-4436-8e5d-154fe5c3bcb5` | PASS | Test-only checksum validation rejected mutation before PUT; HEAD 404 |
| A06 | `S3BasicCompatibilityTest.A06_deleteAndRepeatedDeleteLeaveTheObjectAbsent` | `36fbd43b-825f-4cf4-beea-a2a3e9186fe0` | PASS | Repeated DELETE left object absent |
| A07 | `S3PersistenceTest.A07_objectSurvivesContainerRecreationOnTheSameNamedVolume` | `2576a5cb-a359-4d9a-b334-e7420850adb7` | PASS | Same-volume restart preserved 1,000,003 bytes; SHA-256 `9a1094c3eb5426fc25a2fd7e971348673ac28b4dcb2bc05092a231a6b3949d95` |
| A08 | `S3ConditionalWriteTest.A08_ifNoneMatchStarPreservesTheFirstObject` | `ef49c46a-5790-4d55-8223-6348d14f8e0c` | PASS | Conditional create rejected overwrite with HTTP 412 and preserved first payload |
| A09 | `S3ConditionalWriteTest.A09_concurrentConditionalPutsHaveExactlyOneVisibleWinner` | `ef49c46a-5790-4d55-8223-6348d14f8e0c` | PASS | Five barrier-synchronized trials had one accepted writer and one complete payload |
| A10 | `S3FailureTest.A10_unavailableEndpointFailsBoundedlyWithoutFalseSuccess` | `7dc755e8-2a43-40a1-9cb2-5ff670d7331a` | PASS | Single-attempt local connection failure; direct HEAD absent; healthy PUT verified |
| A11 | `S3FailureTest.A11_upstreamInterruptionOccursAfterAnObservedBodyBarrier` | `7dc755e8-2a43-40a1-9cb2-5ff670d7331a` | PASS | Gate reset after forwarding at least 65,536 bytes; direct GET absent; no incomplete object observed |
| A12 | `S3FailureTest.A12_serverSuccessObservedBeforeTheResponseIsDropped` | `7dc755e8-2a43-40a1-9cb2-5ff670d7331a` | PASS | Unknown-result hazard reproduced after provider HTTP 200; independent GET byte-equal |
| A13 | `S3FailureTest.A13_containerRestartDuringHeldPutIsReconciledByDirectRead` | `7dc755e8-2a43-40a1-9cb2-5ff670d7331a` | PASS | Restart with 65,536+ bytes held; direct GET absent in this run |
| A14 | `S3FailureTest.A14_deleteInterleavedWithBodyBarrierCannotProducePartialVisibleBytes` | `7dc755e8-2a43-40a1-9cb2-5ff670d7331a`; repeats: `c7077001-970b-4457-9e19-5d5d126280d1`, `8a27a3e5-2d25-458e-a4ca-2efbc50a9d64`, `39607b52-f35c-438b-afb5-e9c4ed795c11`, `1423ebeb-d70e-4c57-9d40-9803777d56e7` | PASS, 5 executions | **Hazard reproduced:** 4/5 late PUTs completed after DELETE 204 and were visible as complete objects; one SDK timeout had an absent follow-up GET |
| A15 | `S3FailureTest.A15_conditionalPutInterleavedWithDeleteHasAtMostOneCompleteVisibleObject` | `7dc755e8-2a43-40a1-9cb2-5ff670d7331a`; repeats: `c7077001-970b-4457-9e19-5d5d126280d1`, `8a27a3e5-2d25-458e-a4ca-2efbc50a9d64`, `39607b52-f35c-438b-afb5-e9c4ed795c11`, `1423ebeb-d70e-4c57-9d40-9803777d56e7` | PASS, 25 trials | **Hazard reproduced:** 20/25 late conditional PUTs completed after DELETE 204 and were visible as complete objects; five timed-out attempts had absent follow-up reads. Conditional PUT does not fence an in-flight writer |
| A16 | `S3BasicCompatibilityTest.A16_missingObjectHeadIsClassifiedAsNotFound` | `36fbd43b-825f-4cf4-beea-a2a3e9186fe0` | PASS | Missing key classified as HTTP 404 / `NoSuchKey` |
| B01 | `RecoveryProtocolTest.B01_intentIsDurableAndRecoverableAfterCoordinatorRecreation` | `f76d81b8-2d77-4a4e-a721-85c96fcf4093` | PASS | PostgreSQL intent/attempt recovery in disposable simulator |
| B02 | `RecoveryProtocolTest.B02_s3CommitThenDatabaseFailureRemainsTrackedButNeverAttached` | `f76d81b8-2d77-4a4e-a721-85c96fcf4093` | PASS | PUT + injected DB rollback; direct reconciliation verified and deleted unassociated object |
| B03 | `RecoveryProtocolTest.B03_identicalIdempotencyRetryReturnsTheSameFileAndAttempt` | `f76d81b8-2d77-4a4e-a721-85c96fcf4093` | PASS | Same request fingerprint returns same intent/attempt in simulator |
| B04 | `RecoveryProtocolTest.B04_requestFingerprintMismatchAndTerminalIntentCannotResurrect` | `f76d81b8-2d77-4a4e-a721-85c96fcf4093` | PASS | Mismatch conflicts and terminal intent stays terminal in simulator |
| B05 | `RecoveryProtocolTest.B05_staleNoteVersionRejectsFinalizeButRetainsUploadedBytesForRetry` | `f76d81b8-2d77-4a4e-a721-85c96fcf4093` | PASS | Stale version blocked; staged bytes retained for retry in simulator |
| B06 | `RecoveryProtocolTest.B06_competingParentClaimsHaveExactlyOneWinner` | `f76d81b8-2d77-4a4e-a721-85c96fcf4093` | PASS | PostgreSQL accepted one concurrent claim in simulator |
| B07 | `RecoveryProtocolTest.B07_expiredInFlightAttemptRemainsTrackedAcrossEarlyAbsentCheckAndLateCommit` | `f76d81b8-2d77-4a4e-a721-85c96fcf4093` | PASS | One late write was found/deleted after coordinator reconstruction; UNKNOWN attempt stayed tracked. **Finite UNKNOWN retirement remains unsolved.** |
| B08 | `RecoveryProtocolTest.B08_deleteFailureKeepsLogicalRemoveDurableAndRetryableAcrossCoordinatorRestart` | `f76d81b8-2d77-4a4e-a721-85c96fcf4093` | PASS | Failed S3 delete remained inaccessible and retryable after coordinator restart in simulator |
| B09 | `RecoveryProtocolTest.B09_confirmedPhysicalDeletionRetainsTerminalTombstoneAndRejectsRetry` | `f76d81b8-2d77-4a4e-a721-85c96fcf4093` | PASS | Confirmed delete kept a terminal simulator tombstone |
| B10 | `RecoveryProtocolTest.B10_lostFinalizeResponseReplayDoesNotClaimTwiceOrIncrementVersionAgain` | `f76d81b8-2d77-4a4e-a721-85c96fcf4093` | PASS | Replay returned committed claim/version in simulator |
| B11 | `RecoveryProtocolTest.B11_ordinaryContentPatchCannotRemoveTheProtectedInlineImageAssociation` / `NoteFileContractModel` | `f76d81b8-2d77-4a4e-a721-85c96fcf4093` | PASS | **Model only:** ordinary PATCH preserved modeled image association |
| B12 | `RecoveryProtocolTest.B12_repeatedInlineReferencesShareOneAssociationUntilExplicitLastRemoval` / `NoteFileContractModel` | `f76d81b8-2d77-4a4e-a721-85c96fcf4093` | PASS | **Model only:** repeated references and final removal behavior simulated |
| B13 | `RecoveryProtocolTest.B13_archiveTrashAndRestorePreserveBytesAndRestrictTrashReads` / `NoteFileContractModel` | `f76d81b8-2d77-4a4e-a721-85c96fcf4093` | PASS | **Model only:** archive/Trash/restore access behavior simulated |

### Test-source ownership

- `S3BasicCompatibilityTest`: A01–A03, A06, A16.
- `UploadValidationPolicyTest` and `S3UploadPolicy`: A04–A05; test-only bounded-file validation, not a production upload API.
- `S3PersistenceTest`: A07.
- `S3ConditionalWriteTest`: A08–A09.
- `S3FailureTest` and `S3FaultGate`: A10–A15. A12 records upstream HTTP 200 before dropping the client response. A14/A15 record the 65,536-byte body barrier, DELETE result, PUT outcome, and independent direct GET.
- `RecoveryProtocolTest`, `RecoveryCoordinator`, PostgreSQL Testcontainers, and SeaweedFS: B01–B10, an isolated protocol simulator, not production File or Notes integration.
- `NoteFileContractModel` called from `RecoveryProtocolTest`: B11–B13, behavioral models only.

## Interpretation and decision request

The pinned provider/SDK passed the exercised authenticated path-style S3 operations, byte round-trip, validation-policy, persistence, conditional-write, missing-key, and controlled-fault cases. A12 demonstrates an unknown client outcome after provider commit. A14 and A15 show that a successful DELETE does not fence a PUT already receiving bytes; conditional creation also does not fence it. Stable-key delete or conditional-write-only cleanup is unsafe for the tested races.

Per-attempt physical keys plus PostgreSQL intent/tombstone records allowed the simulator to find and delete the one exercised late write and to retry a failed delete after restart. B07 did not prove a provider-side maximum delay, authoritative termination, or a finite safe retirement rule. An UNKNOWN attempt may therefore require indefinite retention/reconciliation unless a separate mechanism is proven. B11–B13 do not exercise Notes production behavior.

**Decision requested:** for future architecture review, choose whether to investigate indefinite UNKNOWN-attempt retention/reconciliation, require evidence of a valid delay bound or authoritative fencing before finite retirement, or evaluate provider inventory/sweeps as defense in depth. No production strategy is selected here. Issue #75 and draft ADR PR #93 remain pending human review.

## Historical image correction

The originally approved `ghcr.io/seaweedfs/seaweedfs:4.54.0@sha256:7cb5cb29c7c0358a7c9f68ccdb0a79a46cfdb5c45194d843b5d183fef4e1f21a` was an empty OCI artifact with no executable or platform. That startup failed before an S3 request and provides no compatibility evidence. The user approved the corrected runnable image at the digest above. The prior image-pull timeout and correction remain part of the historical observation; they are not part of the clean-checkout pass count.
