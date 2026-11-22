# PR #94 — S3 POC Evidence and Reproducibility Remediation Plan (Luna)

> **State:** PLAN / handoff only. No remediation executed by creating this document.
>
> **Luna:** Use `superpowers:executing-plans` **inline, sequentially, with NO subagents**. This is a scoped remediation of PR #94, not authorization to choose production recovery behavior, modify the accepted D-01–D-29 decisions, accept/merge ADR #93, start #76, or close #75. Follow repo `AGENTS.md`, `server/AGENTS.md`, `.agents/skills/align-context/SKILL.md` and `docs/ai/INDEX.md` before editing. Stop and ask if a new decision or safety invariant is encountered.
>
> **Branch:** `poc/75-s3-compatibility` (the EXISTING head of PR #94). **Do not create a parallel PR, switch to master for changes, or overwrite the ADR draft branch.**
>
> **Authoritative inputs:** [PR #94](https://github.com/krishna916/horizon/pull/94); [#75 approved requirements and proof cases](https://github.com/krishna916/horizon/issues/75); [original POC execution plan](../../../docs/superpowers/plans/2026-11-22-issue-75-s3-compatibility-poc.md); [draft ADR PR #93](https://github.com/krishna916/horizon/pull/93); `results/REPORT.md`, `results/observations.md`, `results/DECISION-OPTIONS.md` in this directory. The draft ADR is NOT accepted.

## 1. Findings to remediate — baseline, not new design decisions

The review of PR #94 on 2026-11-22 confirmed that the **PR contains only four tracked Markdown documents**: the original plan, `REPORT.md`, `observations.md`, and `DECISION-OPTIONS.md`. The standalone Maven/Compose harness and test sources referred to by the report are **not in the submitted PR**. Thus the reported `29 tests, 0 failures/errors` cannot currently be reproduced from the GitHub branch. The report's statements are useful observations, not independently audited execution evidence.

Observed/report-claimed conclusions needing accurate labeling:

- **A12:** fault gate saw SeaweedFS HTTP 200 for completed PUT, dropped the response; a separate GET verified bytes — uncertain client outcome can occur after remote success.
- **A14:** DELETE returned 204 while PUT was paused after the request-body barrier; PUT finished afterward and object was visible — post-delete object risk **confirmed in reported experiment**.
- **A15:** conditional `If-None-Match: *` PUT can likewise complete after DELETE. A successful test of this *hazard detection* is **not proof that conditional PUT makes cleanup safe**.
- **B07:** per-attempt key + durable UNKNOWN attempt record detected/deleted the exercised late object, but did **not** establish a finite safe retirement rule for arbitrarily delayed writes.
- **B11–B13:** behavioral models only, not integration tests of the running Note module.

**Goal of this remediation:** make the POC executable/reproducible from PR #94, substantiate/correct every reported result, and provide a precise, evidence-based recommendation with the unresolved UNKNOWN-attempt decision still reserved for human review.

## 2. Hard scope limits and guardrails

**Allowed changes only:** files under `server/poc/s3-compat/` (standalone harness, Compose, fixtures/helpers, README, scoped .gitignore, reviewed evidence/report/options and this plan), plus the **PR #94 description**. If a repo-level ignore entry prevents a required POC file being tracked, use targeted `git add -f` on that path only, or propose a narrow POC-specific ignore exception for approval. Do **not** use broad `git add -f .`.

**Forbidden:** changes to `server/pom.xml`, `server/compose.yaml`, `server/src/`, Note/File production code, Flyway migrations, `client/`, PRDs/Constitution, ADR draft content or status, production endpoints, other issues, main infrastructure, public S3, credentials, provider substitution, unapproved version upgrades, ADR merging or #75 closure.

**Preserve approved pins already documented in `REPORT.md`** (do not choose new versions): SeaweedFS 4.54 runnable `ghcr.io/chrislusf/seaweedfs` linux/amd64 digest `sha256:e7d4b80af9bd49b2630a60ac6fbb7ffb620ac6a2c501f689c22a71b9f89f0203`, AWS SDK Java v2 2.59.2, Testcontainers Java 2.0.5, Toxiproxy 2.13.0 pinned image, disposable PostgreSQL 17.12 and pgJDBC 42.7.14 as recorded. Verify actual pins in checked-in files match report. New pins/provider or changed risk assumptions require explicit user approval.

**No secrets or generated artifacts in commits:** never commit real `.env`, access keys, test fixture binaries, Maven `target`/Surefire outputs, proxy raw traces with headers, persistent volume data, or real user content. POC must use disposable data and loopback/local test endpoints only. Do not run `docker compose down -v` before capturing same-volume restart evidence; never delete the application's PostgreSQL volume.

## 3. Task 0 — Inspect and recover existing local test source before touching reports

- [ ] Check out and fetch **`poc/75-s3-compatibility`** at PR #94 head; verify clean/dirty working tree and current branch.
- [ ] Read all authoritative inputs and repository agent instructions; run the required `align-context` review. Record the actual existing POC environment and the evidence already on the PR.
- [ ] Run `git ls-files server/poc/s3-compat` and `git status --short --untracked-files=all`. Specifically inspect whether `server/poc/s3-compat/pom.xml`, `compose.yaml`, `README.md`, test sources and fault helpers exist **only as ignored/untracked local files**. Use `git check-ignore -v PATH` to find the exact ignore rule. Current PR head has no tracked executable harness.
- [ ] Recover the **actual source used for the recorded runs** if available. Do not fabricate source, pretend freshly reconstructed code was the original source, or silently backfill logs. If original source is irretrievably unavailable, **STOP and disclose**. Reconstruct a new independent harness only after user approval and label resulting evidence as a new run, not verification of the old runs.
- [ ] Make a scoped file inventory with purpose/test ownership, pins and whether each file is tracked. Confirm no source, test harness or dependency was pulled from a private/production storage location inappropriately.

**Exit:** exact source files and their provenance are known. If executable source cannot be recovered, do not continue claiming PR #94 is reproducible.

## 4. Task 1 — Commit a standalone, executable and safely isolated POC

Expected minimal shape (adjust to match recovered *actual* implementation, not as a license to rewrite it):

```text
server/poc/s3-compat/
├── REMEDIATION-PLAN.md              # this handoff
├── README.md                         # prerequisites, exact commands, expected outputs, teardown
├── pom.xml                           # isolated pinned Java 25/JUnit/AWS SDK/Testcontainers deps
├── compose.yaml                      # private test SeaweedFS; pinned digest; dedicated volume
├── .env.example                      # placeholders ONLY, if actually needed
├── .gitignore                        # local .env/target/temp/evidence exclusions
├── src/test/java/...                 # actual A01–A16 and B01–B13 tests/harness
├── src/test/resources/...            # safe text fixtures ONLY, if needed
└── results/
    ├── REPORT.md
    ├── observations.md
    └── DECISION-OPTIONS.md
```

- [ ] Add/restore the actual standalone Maven `pom.xml`, pinned provider Compose setup, Java test sources and minimal TCP gate/fault helper(s). Ensure tests and lifecycle commands do **not** depend on ignored local paths or undisclosed files.
- [ ] Make test data deterministic or clearly seeded; distinguish **direct** S3 inspection client from **fault-proxied** client, isolate run IDs and keys; verify SDK retries disabled or documented for fault attribution.
- [ ] Keep original provider image correction evidence intact; the accidentally chosen non-runnable `ghcr.io/seaweedfs/seaweedfs` manifest is historical failure evidence, **not** a pin to reintroduce.
- [ ] Pin every required container and Maven test dependency as already approved. Check Java 25 compatibility and preserve the single-machine, dedicated-volume persistence probe.
- [ ] Preserve the actual Layer B implementation's status as a **disposable test-only PostgreSQL coordinator**, not File module code; B11–B13 remain marked models only.
- [ ] Add safe repeatable startup/cleanup instructions; ports restricted to loopback, temporary credentials not hardcoded into public logs, no access to `server/database` or the regular application storage.
- [ ] Stage and inspect the exact diff. Do not commit generated files, Maven target output, data volumes or accidental secrets.

**Exit:** a reader of PR #94 can inspect every class, dependency and fault gate that generated the test observations.

## 5. Task 2 — Prove reproducibility from a clean checkout

The previous workstation's leftover source files and volumes MUST NOT be necessary to run the POC.

- [ ] Run from a **fresh clean checkout/worktree of the PR branch** in an isolated directory, with empty/untracked state. Record branch commit SHA, OS/architecture, Docker, Java, Maven, image digests and the environment used.
- [ ] Verify prerequisites using commands such as:

```bash
git status --short
git ls-files server/poc/s3-compat
docker version
docker compose version
java -version
cd server
./mvnw -version
```

- [ ] Run the standalone POC using checked-in README's exact startup, bucket/bootstrap, test and teardown commands. The baseline requested verification command is:

```bash
cd server
./mvnw -f poc/s3-compat/pom.xml test
```

- [ ] Reproduce all A01–A16/B01–B13 **from committed source**. If particular tests require an isolated Compose lifecycle or a second command, put that exact step in README; never rely on a manual action left undocumented.
- [ ] For A12, require the proxy/gate to observe an actual **provider success response before dropping the client reply**, plus independent readback; a timeout alone is `INCONCLUSIVE`.
- [ ] For A14/A15, require recorded objective in-flight PUT body barrier, DELETE response, release of PUT, and final independent object read; repeat the race with recorded count/observations. A successful hazard reproduction is NOT a safe cleanup outcome.
- [ ] For B07, require persisted UNKNOWN attempt/locator, early negative HEAD while writer still in flight, later PUT settlement, post-restart reconciliation/delete and retained tombstone/locator. Clearly state **what remains unproved**.
- [ ] Capture sanitized Maven/Surefire summary and test names, exact run ID(s), assertions, key/digest observations, independent S3 verification and the relevant PostgreSQL facts; avoid committing bulky raw logs. Record any failures and differences from the original report as **new observations** rather than altering history.
- [ ] If execution is blocked (Docker unavailable, permission denied, non-amd64 host, image unavailable), mark **NOT_RUN/BLOCKED with exact error**. Do not report a PASS without a completed run.

**Exit:** reviewer can reproduce the result without accessing Luna's original development workspace. If a clean run fails, PR must say so; do not silently leave the old green summary as if newly verified.

## 6. Task 3 — Correct report/observation provenance and classification

- [ ] Reconcile `REPORT.md`, `observations.md` and `DECISION-OPTIONS.md` against actual checked-in tests and new run output. Keep original run history with timestamps/provenance; append separate clean-run observations rather than rewriting historical evidence as if it came from the new commit.
- [ ] Update the report's "standalone harness implemented on branch" statement to match what is **actually committed** and the clean-checkout execution status.
- [ ] Add a compact case ledger with columns: **case**, **test/class**, **evidence run ID**, **test execution (PASS/FAIL/NOT_RUN)**, **architecture conclusion (compatible / hazard reproduced / model only / still open)**. This prevents false equivalence between a test asserting a hazard and a design guarantee.
- [ ] Specifically classify **A14/A15 as "test PASS — hazard reproduced; stable-key DELETE/conditional-PUT-only protocol UNSAFE"** if the new evidence corroborates that result; if not reproducible, classify as INCONCLUSIVE and show why.
- [ ] Distinguish **B01–B10: isolated PostgreSQL/SeaweedFS protocol simulator** from **B11–B13: behavior models only**. No claim that Notes production authorization/editor lifecycle has been integrated.
- [ ] Clarify **B07 "tested cleanup of one late write" versus "general unknown-attempt closeout NOT SOLVED"**. Do not make a blanket `no-orphan guarantee` or call the recovery protocol production-accepted.
- [ ] Make the test count precise: `29 cases` are not necessarily `29 tests` unless source/runner confirms exactly 29 executable tests. Document any repeated trials separately.
- [ ] Include the exact pinned **SeaweedFS 4.54** digest, SDK/tool versions, supported platform, sanitized run summary, README links, retained data/teardown state and explicit POC-only limitations.

**Exit:** every claimed result has corresponding executable test and independently reviewable observations, or is explicitly downgraded to NOT_RUN/INCONCLUSIVE.

## 7. Task 4 — Unknown-attempt closeout: analysis and optional *test-only* falsification

**This is the remaining design gate. The goal is to expose the tradeoff, not to choose a production policy.**

- [ ] Explain why one negative HEAD, DELETE 204, the end of the caller's lease, or an SDK timeout is insufficient to prove no remotely delayed writer remains. Distinguish *logical non-resurrection* (DB tombstones) from *eventual physical cleanup of late bytes*.
- [ ] Evaluate **at least** these boundedly described options in `DECISION-OPTIONS.md`: (1) retain UNKNOWN attempt key and periodically reconcile indefinitely until authoritative settlement; (2) allow finite retirement **only after evidence of a valid upper bound or authoritative termination/fencing mechanism**; (3) longer-term provider-side inventory/sweep plus keyed attempts as defense in depth. Do not assert that inventory alone can stop writes that complete after its final scan.
- [ ] For each candidate, state metadata/retention cost, recoverability after restart, expected storage/worker overhead, whether it satisfies "no permanently untracked orphan", and what **must** be proven for safe terminal deletion.
- [ ] Where the **existing isolated harness** permits it without new architectural commitments, add a targeted controlled case: delay a PUT across at least one negative HEAD and cleanup pass; verify attempt locator remains and eventual late bytes are found/deleted. Demonstrate it after coordinator reconstruction. Label it a **falsification scenario**, not proof of a universal delay bound.
- [ ] Avoid new production SQL, File APIs, retention constants, lease/fencing choices or recovery policy. If extra test infrastructure or a new version pin is required, **STOP FOR APPROVAL** instead of treating it as incidental.
- [ ] Write a concise **explicit decision request** for the user, citing the observed hazards and remaining failure bounds; maintain status "PRODUCTION RECOVERY STRATEGY PENDING". Do not decide this merely because the per-attempt-key prototype worked in B07.

**Exit:** decision options and residual risks are clear enough for an informed human review, without claiming the issue is solved.

## 8. Task 5 — Update PR #94 and final audit

- [ ] Add a meaningful **PR #94 description**: scope, exactly what source was restored/committed, instructions to reproduce, approved pins, observed risk A12/A14/A15, B07 limitation, case-classification caveats, exact test results and links to #75/ADR #93. No automatic merge/acceptance wording.
- [ ] Verify documentation paths are relative where practical and that `README.md` and reports link to the actual committed source/test names.
- [ ] Check diff and branch scope:

```bash
git status --short
git diff --name-only master...HEAD
git ls-files server/poc/s3-compat
git check-ignore -v server/poc/s3-compat/pom.xml || true
```

- [ ] Ensure only scoped POC files, existing original-plan file and PR description changed. Do not rewrite #75 acceptance criteria, edit ADR #93, merge PRs or close #75.
- [ ] Execute the complete clean-checkout validation one last time and record the actual output. If the evidence diverges from earlier observations, show the discrepancy, do not hide it.
- [ ] Summarize in PR #94: **what is proved**, **what is a simulated contract**, **what remains open**, **what user approval is needed next**. Link or reference this plan in the PR conversation for Luna's review and handoff.

### Final definition of done for the remediation PR

- [ ] Runnable `pom.xml`, pinned private `compose.yaml`, all necessary test/fault code and usage README are **tracked on PR #94**.
- [ ] Test harness works from a clean checkout or an explicit reproduced blocker is recorded.
- [ ] Every A01–A16/B01–B13 has truthful outcome/provenance/test source mapping, with A14/A15 risks and B11–B13 model scope clearly separated.
- [ ] B07 UNKNOWN-attempt lifetime is **explicitly unresolved or separately approved after evidence**, never silently accepted.
- [ ] PR #94 has a reviewable summary, exact run instructions and clean scope.
- [ ] No production Note/File code, main server dependencies, normal Compose, Flyway migrations, ADR status, source PRDs or Constitution were changed.

**STOP and present results for human review. Do not merge PR #94, approve a production recovery protocol, mark ADR #93 accepted, close #75 or start #76 without explicit approval.**
