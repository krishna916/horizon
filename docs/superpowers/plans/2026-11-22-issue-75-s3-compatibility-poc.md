# Issue #75 — SeaweedFS S3 Compatibility & Recovery POC: Luna Execution Plan

> **Status:** PLAN ONLY · Not executed · Requires explicit implementation go-ahead.
>
> **For Luna:** Use the `superpowers:executing-plans` workflow **inline and sequentially**. **Do not use subagents.** Read this plan and the references before editing code. The POC is experimental evidence, not production File-module delivery. Do not merge, close #75, accept the File ADR, or approve a recovery strategy without explicit human authorization.

**Goal:** Prove that a **pinned** SeaweedFS S3 endpoint works with **AWS SDK for Java v2**, then reproduce the unknown-outcome PUT / cleanup races with credible evidence. Use the results to support an explicit decision on the still-open recovery protocol. Keep the implementation deliberately small and isolated.

**Architecture:** A self-contained Java 25 / Maven proof harness, a private single-node SeaweedFS test deployment, optionally Testcontainers/Toxiproxy for fault injection, and **only if needed** a minimal disposable PostgreSQL-backed protocol simulator. No production Spring Boot File module, no public routes, no Note integration and no database migrations in this issue.

**Reference sources (read in this order):**

1. [#75 requirements, 29 decisions, A01–A16/B01–B13 matrix](https://github.com/krishna916/horizon/issues/75).
2. [Draft File ADR in PR #93](https://github.com/krishna916/horizon/blob/docs/75-file-architecture-adr-draft/docs/architecture/adr/ADR-DRAFT-shared-file-object-storage.md) — **not accepted**.
3. [#55 approved File-storage direction](https://github.com/krishna916/horizon/issues/55); [#68 Notes UX](https://github.com/krishna916/horizon/issues/68); [#76 File foundation](https://github.com/krishna916/horizon/issues/76); [#77 recovery](https://github.com/krishna916/horizon/issues/77).
4. [`AGENTS.md`](../../../Agents.md), [`server/AGENTS.md`](../../../server/AGENTS.md), [align-context skill](../../../.agents/skills/align-context/SKILL.md), [`docs/ai/INDEX.md`](../../ai/INDEX.md), and ENG-001 engineering rules.
5. Official [Testcontainers Toxiproxy documentation](https://java.testcontainers.org/modules/toxiproxy/), [AWS Java v2 upload behavior](https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/best-practices-s3-uploads.html), and the **pinned SeaweedFS release's** `weed mini`/S3/conditional-write documentation.

**Source alignment:** `server/pom.xml` currently targets **Java 25 / Spring Boot 4.0.6** and includes Testcontainers for application tests, but **does not** have an AWS SDK S3 dependency. `server/compose.yaml` currently provisions PostgreSQL only. Keep the POC standalone: do not change either of those production files. The approved D-01–D-29 rules, including `size < 20 MiB`, known-length transfer, client SHA-256, bounded temp validation, private S3, and single-claim/expiry invariants, are constraints — **not choices to reopen**.

---

## 0. Scope, authority and stop rules

**In scope:** private bucket bootstrap/auth, AWS SDK v2 path-style/endpoint/credentials, byte integrity, Delete, restart persistence, conditional PUT, deterministic injected faults, results/evidence and a **proposal** comparing safe recovery alternatives. A minimal throwaway PostgreSQL state-machine harness is allowed after the recovery-protocol review gate, if needed to test B cases.

**Out of scope:** creating `file` production packages, altering `note` implementation, modifying `server/pom.xml`, changing production `server/compose.yaml`, adding Flyway migrations or REST endpoints, making PRD/Constitution edits, changing the ADR status, implementing #76/#77, Task/Journal files, provider substitution, public/presigned URLs, multipart or resumable uploads.

**Explicitly pending human approval:** SeaweedFS version/image digest, AWS SDK Java v2 version, Testcontainers/Toxiproxy pins; choice of stable versus attempt-specific physical object keys; cleanup/fencing/lease algorithm; any other design change beyond D-01–D-29. **Stop at those gates.** Do not claim test execution, provider acceptance, a safe recovery design, or ADR acceptance merely because this plan exists.

**Environment blockers:** First check `docker version`, `docker compose version`, `java -version`, and `./mvnw -version` from `server/`. If Docker or a suitable Java runtime is unavailable, label the blocked test cases `NOT_RUN`, record the actual blocker, and stop; do **not** fake results or silently use a different cloud service.

## 1. Recommended artifact layout (POC only)

Create these files **only after implementation authorization**. The layout is a scoped implementation convenience, not a production architecture decision:

```text
server/poc/s3-compat/
├── README.md                       # exact run/teardown and safety instructions
├── pom.xml                         # independent, pinned Maven test harness
├── compose.yaml                    # isolated SeaweedFS fixture, private test credentials
├── .env.example                    # placeholders only; never commit .env or keys
├── .gitignore                      # .env, target, temp, unsafe raw captures
├── src/test/java/com/krishnamurti/horizon/poc/s3/
│   ├── S3Environment.java          # setup and direct/proxied clients
│   ├── ProofEvidence.java          # case ID, observation, redaction and outcome
│   ├── S3BasicCompatibilityTest.java    # A01–A03, A06, A16
│   ├── UploadValidationPolicyTest.java # A04–A05 (standalone policy harness)
│   ├── S3PersistenceTest.java      # A07 (actual restart, same volume)
│   ├── S3ConditionalWriteTest.java # A08–A09
│   ├── S3FailureTest.java          # A10–A15; controlled barriers
│   └── RecoveryProtocolTest.java   # B cases, AFTER recovery strategy approval
└── results/
    ├── REPORT.md                   # filled after real runs, each A/B status
    └── DECISION-OPTIONS.md         # evidence-based comparison, NOT an ADR decision
```

If a test needs a tiny test-only proxy/fault-gate helper, keep it here, **not** in production code. If Testcontainers can provide the requisite **observable timing barrier**, do not build the helper. Do not introduce a separate project dependency graph or package module that the application consumes.

## 2. Task 0 — Context, candidate versions and approval gate

- [ ] Read source links in the header and run `align-context` / index lookup as required by `AGENTS.md`; confirm #75 and draft ADR are still current. Read `server/pom.xml`, `server/compose.yaml` and the existing Maven test conventions.
- [ ] Confirm available Docker Engine/Compose, Java **25**, Maven wrapper, host architecture, available port/volume capacity. Do not use live Horizon data or the normal app database.
- [ ] Identify a **specific SeaweedFS release and immutable image digest**, matching startup flags and S3 auth behavior for that release. Identify an exact **AWS SDK Java v2** dependency and **Testcontainers/Toxiproxy** versions/images. Check dependency compatibility against the standalone harness and current project toolchain. Record rationale and official sources.
- [ ] **STOP FOR USER APPROVAL** of this exact pin set before treating runs as an approved conformance proof. A version suggestion is not acceptance. Never default to `latest`, unpinned container tags, or a silently substituted S3 provider.
- [ ] Decide only **test-fixture values** (not app design): dedicated test-only bucket/credentials/volume, loopback-only port and generated test keys. Expose no secrets in a PR, logs or artifacts. Document how local credentials are injected.

**Output:** Candidate-pins table (`component`, `version`, `digest if image`, `source`, `rationale`, `approved?`), environment check, and blocker/approval note in `results/REPORT.md`.

## 3. Task 1 — Standalone harness and smoke test

- [ ] Add standalone `pom.xml` under `server/poc/s3-compat/`: Java 25, JUnit 5, approved pinned AWS SDK Java v2 and Testcontainers dependencies. Do not touch `server/pom.xml` or existing application tests. Configure deterministic UTC execution and reasonable SDK network timeouts; make SDK retry settings explicit and observable.
- [ ] Add isolated `compose.yaml` with **approved digest** and persisted **dedicated** test volume. Confirm the correct SeaweedFS startup command and credential/bucket initialization from **that release's** docs; do not assume undocumented behavior of `weed mini`.
- [ ] Bind any published S3 port to `127.0.0.1` for human smoke tests. Tests must also be able to access the service on a dedicated Docker network. Authenticate with test-only keys; verify a bad key and unsigned request cannot read objects. Guard against SeaweedFS accidentally starting with unauthenticated allow-all access.
- [ ] Add `S3Environment` with two independently configured clients: **client via proxy** for faults; **direct SDK client** for post-fault independent verification. Set endpoint override, path-style addressing, region, explicit credentials and bounded timeouts. The direct verification path must not inherit the proxy fault.
- [ ] Add deterministic byte generator and independently computed SHA-256. Use unique proof run ID and test key per case, avoiding real filenames or PII; do **not** assume S3 ETag equals SHA-256.
- [ ] Write A01/A02/A03/A06/A16 tests first; execute and capture **actual** HTTP/SDK observations. For all negative cases check *object state* independently, not just an exception.

**Verification command (from `server/`; exact class/path adjusted only if needed):**

```bash
./mvnw -f poc/s3-compat/pom.xml -Dtest=S3BasicCompatibilityTest test
```

**Pass gate:** private signed bucket/operations work, exact PUT→HEAD→GET bytes, metadata/length, Delete+repeat behavior, and missing-object/error classification. Failed auth must not silently fall back to public access.

## 4. Task 2 — Boundary, checksum, persistence and conditional writes

- [ ] A04: implement a **minimal POC-only validation function**, not a production File service. It must accept **20,971,519** observed bytes and reject **20,971,520**, unknown length, and declared-vs-observed mismatches **before PUT**. Verify rejected files never reach S3.
- [ ] A05: given a known-length deterministic temp file, independently recompute SHA-256 and compare to declaration **before PUT**; intentionally mutate bytes and verify no S3 object was created. Reflect D-26/27/29. Use a **bounded temporary file**, not an unbounded memory blob.
- [ ] A07: PUT and record SHA-256; **stop/recreate the SeaweedFS container while retaining the exact same named volume**, then direct GET and compare. `docker compose down -v` is prohibited until all restart evidence has been captured.
- [ ] A08: PUT same key with `If-None-Match: *` and record accepted/failed outcomes plus preserved first payload. Confirm the pinned **SDK** actually sends the condition and the pinned **provider** enforces it (do not assume method availability or error code without compiling/observing).
- [ ] A09: run concurrent conditional PUTs with different deterministic payloads to the same absent key, synchronize start, record both results and assert **one complete** visible winner. Include repeated trials with run IDs and checksums.
- [ ] A10: unreachable endpoint or injected disconnect yields **bounded** client failure, no false success; retry after service restoration can work. Ensure SDK retries are disabled or fully logged during attribution tests.

**Suggested test commands:**

```bash
./mvnw -f poc/s3-compat/pom.xml -Dtest=UploadValidationPolicyTest test
./mvnw -f poc/s3-compat/pom.xml -Dtest=S3PersistenceTest test
./mvnw -f poc/s3-compat/pom.xml -Dtest=S3ConditionalWriteTest test
```

**Pass gate:** A01–A10 are PASS with captured evidence before claiming compatibility; A16 status is also recorded. Conditional PUT works only if it genuinely protects the existing object for the pinned test provider.

## 5. Task 3 — Controlled failure and unknown-result tests (A11–A15)

**Method:** Use a fault proxy (Toxiproxy or a minimal local test-only gate where needed), separately connected from a direct S3 verification client. For each operation record: unique key, SHA-256, proxy configuration, fault direction/trigger, exact barrier event, SDK result, independent Head/Get and service logs. Disable SDK retries for attribution, then run a separate retry-enabled scenario with every request traceable.

- [ ] **A11 — upstream interruption:** throttle/slice an in-flight known-length PUT; prove an upstream body-byte barrier before cutting the connection; inspect remote object. Absent or valid complete outcomes are characterized; an incomplete visible object must **never** be reported as valid Horizon content.
- [ ] **A12 — response lost after proven commit:** have an observable server-commit signal **before** withholding/dropping downstream response. Acceptable evidence: test proxy observed the storage service's successful response before suppressing delivery, plus direct S3 HEAD/GET matching checksum, or an equivalent controlled barrier. A generic client timeout alone is **INCONCLUSIVE**.
- [ ] **A13 — restart with transfer in flight / just completed:** prove the restart boundary, preserve volume, then reconcile after restart with direct Head/Get and digest. Document whether complete object exists and whether client was told success/failure.
- [ ] **A14 — DELETE interleaved with an in-flight PUT:** establish an objective PUT-start/body barrier, issue DELETE against same key, release writer, then inspect object after writer termination and after additional reconciliation. Document whether an object reappears. A DELETE that happened *before* a request ever reached SeaweedFS does **not** prove this race.
- [ ] **A15 — conditional PUT/DELETE interleaving:** repeat with `If-None-Match: *`, capture actual provider error codes (e.g., 409/412 where applicable), one visible final payload at most, and post-fault direct inspection. Conditional writes alone do not establish the no-orphan invariant.
- [ ] For fault cases the proxy cannot reproducibly control, report **INCONCLUSIVE**; make the smallest justified test-gate improvement **inside the POC** and record it. Do not infer safety or choose a cleanup protocol from inconclusive trials.

**Pass gate:** A11–A15 attempted with **credible controlled timing** and reproducible evidence, especially at least one **objective post-commit response-loss** (A12) and meaningful PUT/DELETE interleaving (A14). A surprising provider behavior can be acceptable if a **separately approved** application-level recovery approach handles it; it is not an automatic green light.

## 6. Task 4 — Recovery options comparison; mandatory decision checkpoint

- [ ] Using observed A08/A09/A12–A15 behavior, prepare `results/DECISION-OPTIONS.md` comparing **(A)** stable physical object key + conditional writes + reconciliation and **(B)** immutable per-transfer-attempt physical keys + durable attempt tracking, plus any clearly justified alternative.
- [ ] For each, describe: how an active/late PUT is fenced or later discovered, expiry/claim coordination, cleanup after unknown result, durable metadata required, crash/restart behavior, tombstone behavior, testable invariants and complexity/cost.
- [ ] Explicitly explain why **conditional PUT by itself cannot guarantee that a later PUT cannot recreate an object after DELETE**. Do not claim a PostgreSQL lease alone fences an S3 operation already in flight.
- [ ] State the minimal feasible recovery protocol supported by **actual** experiments, with residual risks and any new schema/locking choices that need user approval.
- [ ] **STOP FOR USER APPROVAL** of the selected physical-key, fencing/reconciliation and cleanup protocol. Do not implement it in a production File module, change the draft ADR's decision status, or assume Layer B passes before approval.

**Output:** concise decision matrix with pros/cons, reproducible observations, recommended approach, outstanding questions, and a clear `USER APPROVAL REQUIRED` marker.

## 7. Task 5 — Minimal Layer B protocol proof (AFTER approval)

**Do not implement the full Note/File modules.** If approved, create a **throwaway** PostgreSQL Testcontainers schema and small Java coordinator model **in the POC test harness**. Keep schema clearly labeled fixture-only; no Flyway migration or production code. Simulate Note version/association via minimal test records, only enough to verify concurrency and durable File behavior. If that cannot be done without premature production design, mark affected B cases `NOT_RUN` or `INCONCLUSIVE`, describe blocker, and ask for review.

- [ ] B01: persist intent before transfer, restart coordinator, recover known intent.
- [ ] B02: successful PUT followed by injected DB update/commit failure; object still discoverable for reconciliation/cleanup; never promoted to attached.
- [ ] B03/B04: same UUID+content/Note → same logical result; mismatch checksum/Note/role/size → conflict; expired/deleted requests never resurrect.
- [ ] B05: Note version changes during transfer → stale finalize rejected and staged bytes remain for authorized retry.
- [ ] B06: two concurrent claims → exactly one atomic winner; no cross-parent sharing.
- [ ] **B07 (release blocker):** expire staging while transfer in flight; demonstrate the explicitly approved fencing/reconciliation protocol cannot leave a permanent untracked late object.
- [ ] **B08 (release blocker):** committed logical remove remains inaccessible while S3 DELETE fails, retry survives restart, and later deletion is verified.
- [ ] B09: after confirmed physical deletion, minimum tombstone enforces terminal idempotency; no silent resurrection.
- [ ] B10: lost finalize response replay/inspect does not double-claim or increment Note version twice.
- [ ] B11/B12/B13: optional **contract-model demonstrations only**, not integration proof of current Notes product: block image-deleting ordinary PATCH, repeated image reference count handling, and Archive/Trash/restore retention. Mark as test-only demonstrations; real integration tests are required later in #78/#79.
- [ ] Every B case must identify **what was actually exercised** (PG+S3, in-memory model, or not run); a simulated unit PASS is not a claim that production lifecycle code exists.

**Pass gate:** B07/B08 safety reasoning and controlled proof are acceptable for explicit user review; all other B statuses accurately disclosed. #77 still owns the production worker, retries and failure tests.

## 8. Task 6 — Evidence, verification and handoff

- [ ] Populate `results/REPORT.md` with **all 29 case IDs (A01–A16, B01–B13)**, each labeled `PASS`, `FAIL`, `INCONCLUSIVE`, or `NOT_RUN`. Do not conflate a failed assertion with an unexecuted test. Include scope level where relevant (`provider`, `POC protocol`, `behavioral model`).
- [ ] For every executed case include: run ID/date/host OS+architecture, **pinned** version/digest, exact commands, test inputs/key, expected/observed SHA-256, fault barrier, SDK error/status, direct S3 state, relevant PG state, sanitized trace/log path and interpretation.
- [ ] Record the approved or pending provider/SDK configuration and any reproducible incompatibilities. Keep credentials and sensitive headers out of committed evidence; omit binary fixtures, live endpoint secrets and giant raw logs from Git. Provide minimal sanitized snippets and local evidence instructions.
- [ ] Document runnable commands and lifecycle: test environment startup, headless integration runs, persistent-volume restart test, teardown, **data removal only from dedicated POC volume**. Do not run destructive tests against normal application Postgres or S3 data.
- [ ] Run isolated POC suite (with pinned dependencies):

```bash
cd server
./mvnw -f poc/s3-compat/pom.xml test
# Also run standalone project's formatting/static checks if configured.
# Check production git diff; it must show no changes to server/src, server/pom.xml or server/compose.yaml.
git diff --name-only master...HEAD
```

- [ ] Review that project normal build commands are unaffected and docs links are repository-relative where possible. Report any environment blocker instead of claiming tests passed without Docker.
- [ ] Present test evidence and the recovery-design options to the user. **Do not merge the POC, modify/accept ADR, close #75, choose another S3 provider, or start #76 without explicit approval.**

### POC report summary table (populate with actual observations)

| Case family | Required evidence | Status before execution |
| --- | --- | --- |
| A01–A03, A06, A16 | Private auth/bucket; exact Put/Head/Get/Delete; errors | NOT_RUN |
| A04–A05 | <20 MiB length and SHA-256 checks before S3 | NOT_RUN |
| A07 | Restart persistence with same volume | NOT_RUN |
| A08–A09 | Conditional PUT and concurrent writer behavior | NOT_RUN |
| A10–A15 | Outage, interrupted PUT, lost reply, restart, PUT/DELETE races | NOT_RUN |
| B01–B06, B09–B10 | Protocol intent, idempotency, version, claim, tombstone, replay | NOT_RUN |
| **B07–B08** | **Expiry/late-write safety and committed delete retry** | **NOT_RUN — approval gate** |
| B11–B13 | Behavioral contract model only; #78/#79 production checks later | NOT_RUN |

### Completion / escalation rules

**A valid POC handoff** contains runnable and audited evidence, a precise provider version and API compatibility result, a clear recommendation/decision matrix for uncertain writes, and honest disposition of every A/B test. This may still leave #75 **OPEN**, because ADR approval, Constitution/PRD amendments and a safe recovery-strategy decision are separate gates.

**Escalate rather than decide:** unsupported SeaweedFS conditional writes, auth inadvertently open to anonymous requests, inability to reliably trigger A12/A14, incomplete visible objects, crash-state ambiguity, version-pin conflict, unsafe cleanup race, unexplained failures, or a need to violate D-01–D-29. Do not conceal any of these behind a green test summary.

**No subagents. No parallel workstreams. No implementation before explicit go-ahead.**