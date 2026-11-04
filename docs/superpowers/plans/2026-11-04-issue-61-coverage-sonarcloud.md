# Issue #61 — Coverage in Verification and SonarCloud CI Implementation Plan

> **For Luna (agentic worker): REQUIRED SUB-SKILL: `superpowers:executing-plans`. Execute this plan inline, task-by-task with RED → GREEN proof and focused commits. Do **not** dispatch subagents. Do not begin implementation until the owner reviews this plan and design.**

**Goal:** Produce validated JaCoCo and Vitest coverage as normal verification outputs and import both into one existing SonarCloud project via GitHub Actions, without rerunning test suites.

**Architecture:** Independent Maven and npm verification jobs each measure their own production code. Each uploads minimal scanner inputs from its single successful test run. One downstream SonarSource CI scan reassembles Java bytecode + JaCoCo XML + LCOV, preserves broad analysis scope, and submits to the existing project after an owner-performed Automatic Analysis → CI migration.

**Tech Stack:** Java 25, Spring Boot 4.0.6, Maven Surefire/Spotless/SpotBugs/Error Prone/PostgreSQL Testcontainers, JaCoCo 0.8.16; React 19, TypeScript 6, Node 24, Vite 8, Vitest 2.1.x/V8 coverage 2.1.x, Playwright; GitHub Actions checkout@v7/upload-artifact@v7/download-artifact@v8; SonarQube Cloud (SonarCloud).

**Spec:** [Owner-reviewed design candidate](../specs/2026-11-04-issue-61-coverage-sonarcloud-design.md) and [Issue #61](https://github.com/krishna916/horizon/issues/61).

## Global Constraints

- Work on **`feature/61-test-coverage-sonarcloud`**, originally from `master` at `bb493c0c075d52929b9e568da83cee58e7ed3b47`; fetch/reconcile latest master before implementation and preserve unrelated work. Do not implement directly on master, merge, disable SonarCloud Automatic Analysis or modify GitHub secrets.
- Read `Agents.md`, `server/AGENTS.md`, `client/AGENTS.md`, `.agents/skills/align-context/SKILL.md`, `docs/ai/INDEX.md`, ENG-001 (Coverage Philosophy), ENG-002, `DEV_SETUP.md`, design and issue. Use repository testing skills when relevant. Follow existing inline-only Luna convention; **no subagents**.
- Baseline: Java **25**, Spring Boot **4.0.6**, PostgreSQL **17**, frontend Node **24** in CI. The older `HORIZON_STATUS.md` Java 21 entry is stale; do not silently downgrade code.
- Single-test-execution requirement: backend normal full gate `cd server && ./mvnw -B -ntp verify`, frontend `cd client && npm run verify`. Vitest runs once with coverage; Playwright remains a separate browser check. No sonar scan test reruns.
- Backend reports: `server/target/site/jacoco/jacoco.xml`, `server/target/site/jacoco/index.html`; frontend: `client/coverage/lcov.info`, `client/coverage/index.html`. Build fails on missing/corrupt/unusable report; HTML remains local by default.
- Preserve existing Spotless/SpotBugs/Error Prone, UTC Surefire JVM option, testcontainers, ESLint, Prettier, TypeScript/Vite build and Playwright. Do not add H2 or production dependencies.
- Owner-approved migration: Automatic Analysis currently ON; **only owner** disables it via SonarCloud Admin at PR-validation checkpoint, after code and secrets are ready. Existing project, Quality Gate, profiles, new-code definition and GitHub required checks must remain unchanged unless owner separately authorizes a change.
- **No percentage threshold** and no artificial tests or broad production-source exclusions to improve coverage. Sonar token is never needed locally. Internal/same-repo PR scan must fail clearly on missing token; fork PR scan must safely skip with build checks intact.
- Every task closes with evidence and a focused commit; do not assert verification passed unless commands actually ran. Document unavoidable blocker and stop before making policy/security decisions. No autonomous merge.

## Review Focus

1. **Surefire agent collision** — Task 1 confirms JaCoCo agent and UTC flag both survive in effective test JVM; includes instrumentation sanity.
2. **Valid but empty/stale reports** — Tasks 1–2 require fresh `clean verify` / clean V8 output and reject missing/empty/malformed/no-measurement files, not just existence.
3. **Source/test overlap or coverage denominator gaming** — Tasks 2–3 verify generated/test paths are classified correctly while untested production files remain in scope.
4. **Report handoff path or missing bytecode** — Task 3 reconstructs exact root-relative paths from uploaded artifacts and tests a deliberately missing-input negative case without rerunning suites.
5. **Fork/secret exposure and Quality Gate drift** — Tasks 3–5 verify fork skip, actionable internal missing-token failure, preserved existing analysis policy, and actual PR+master import evidence.

---

## File Map

| File | Responsibility |
| --- | --- |
| `server/pom.xml` | JaCoCo agent/report, correct Surefire argLine, build-native report/format validation |
| `client/vitest.config.ts` | V8 provider, accurate source coverage population, report types and sane exclusions |
| `client/package.json` | `test:coverage` and single authoritative `verify` script |
| `client/scripts/assert-coverage.mjs` | Small Node standard-library LCOV/HTML fail-fast validation |
| `client/scripts/assert-coverage.test.mjs` | Node built-in test fixtures for valid/missing/invalid/no-execution LCOV |
| `.gitignore` | Ignore `/client/coverage/` |
| `.github/workflows/ci.yml` | Existing separate jobs + minimal artifact handoff + one scanner |
| `sonar-project.properties` (new) | Root multi-language scope, report inputs, Java compiled bytecode |
| `DEV_SETUP.md` | Canonical local commands, CI topology, Sonar admin migration, troubleshooting and corrected Playwright guidance |
| `client/AGENTS.md`, `server/AGENTS.md` (only if necessary) | Keep agent command descriptions accurate; no duplicate technical policy |
| `docs/superpowers/specs/*61*`, `docs/superpowers/plans/*61*` | Approved design and this task plan (already on branch) |

**Dependency flow:** Tasks 1 and 2 are independent. Task 3 depends on both report formats; Task 4 documents the completed setup; Task 5 validates the SonarCloud administrative migration and PR/master outcomes. Every step is done inline; no agent fan-out.

### Task 1: Maven verification produces genuine JaCoCo XML and HTML

**Files:** Modify `server/pom.xml`. Use existing `server/src/test/java/**` suites and Testcontainers; avoid production code edits.

**Interfaces**
- Consumes: `./mvnw -B -ntp verify` and existing Surefire/Spotless/SpotBugs/Error Prone configuration.
- Produces: `target/jacoco.exec`, `target/site/jacoco/jacoco.xml`, `target/site/jacoco/index.html`, and exit status != 0 on missing/corrupt/unusable XML.

- [ ] **Step 1 — RED: capture current failure.** On a clean `server/target`, execute current `./mvnw -B -ntp verify`, then assert `target/site/jacoco/jacoco.xml` is not produced. Record baseline Maven tests/checks and JVM timezone; do not mistake an old `target/` file for a result.
- [ ] **Step 2 — GREEN: add JaCoCo.** In `pom.xml` add `org.jacoco:jacoco-maven-plugin:0.8.16`, `prepare-agent` before test execution and `report` at `verify`, with XML and HTML enabled. Preserve `Spotless` in validate, `SpotBugs` in verify, compiler/Error Prone configuration. Keep existing Java 25 setup.
- [ ] **Step 3 — GREEN: compose Surefire arguments.** Change only its `argLine` to `@{argLine} -Duser.timezone=UTC` while respecting any inherited or added JVM flags; verify `-javaagent` and `user.timezone=UTC` are visible in the actual forked Surefire command (debug output if necessary).
- [ ] **Step 4 — RED → GREEN: fail-fast report guard.** Bind a small JVM/Maven-native validator after JaCoCo report in `verify` (prefer a focused `maven-antrun-plugin` target; do not require Bash/Python/Node for backend). Validate XML is present, nonzero, well-formed with normal JaCoCo DOCTYPE handled safely/offline, and includes report classes/counters; ensure HTML index exists. Run a deliberate missing or malformed XML fixture through the validator in isolation; expected nonzero exit and file-specific error. Restore valid test data before finishing. Do not add any coverage percentage rule.
- [ ] **Step 5 — final actual run.** Execute `cd server && ./mvnw -B -ntp clean verify` with Docker available. Expected: test suite executes once, quality plugins pass, `target/jacoco.exec` nonempty, XML parses with actual per-class counters and at least one covered application line, HTML opens; UTC/Testcontainers integration still succeeds. Do not confuse clean build with `-DskipTests` output.
- [ ] **Step 6 — commit.** `git add server/pom.xml` (plus a verifier file only if strictly necessary) and commit `build(server): integrate and validate JaCoCo coverage`. Record tests run and path checks in task notes.

### Task 2: Single canonical frontend verification with V8 measurement

**Files:** Modify `client/vitest.config.ts`, `client/package.json`, `.gitignore`. Create `client/scripts/assert-coverage.mjs` and `client/scripts/assert-coverage.test.mjs` (or a comparably small standard-library checker/test under `client/scripts/`). Avoid lockfile modification unless dependency correction is truly needed.

**Interfaces**
- Consumes: current `npm run lint`, `npm run format:check`, `npm run test`, `npm run build`, installed Vitest/V8 provider.
- Produces: `npm run verify` invoking Vitest only once with coverage and building frontend; valid `coverage/lcov.info` and `coverage/index.html` or nonzero exit. Fast `npm run test` unchanged.

- [ ] **Step 1 — dependency check and RED validation.** Inspect actual installed/lockfile `vitest` and `@vitest/coverage-v8` versions (2.1.x), compare their compatibility; run `npm run test` and note baseline. Assert `npm run verify` is not yet defined. Do not blindly upgrade Vite/Vitest or add an alternative provider.
- [ ] **Step 2 — write failing report-checker tests.** Use Node's `node:test` and temporary fixture directories for (a) valid LCOV with `SF`, `DA` and positive hit count and HTML index => pass; (b) absent report => fail with `coverage/lcov.info`; (c) malformed/truncated LCOV or no source/line records => fail; (d) only zero execution counts => fail instrumentation sanity; (e) absent HTML => fail. Expose one checker function `assertCoverageReports(coverageDirectory: string): void`, and CLI entry in `assert-coverage.mjs`. Run checker tests and confirm RED before implementation.
- [ ] **Step 3 — implement minimal checker.** Use `node:fs`/`node:path`, no third-party parser/dependency and no HTTP. Check LCOV record consistency, finite nonnegative DA counts, at least one measured source and a positive executed production line, local HTML readability. Re-run Node checker tests: expected GREEN. Do not conflate real 0% coverage of a newly added file with the entire test suite not instrumenting any code.
- [ ] **Step 4 — configure V8.** In `vitest.config.ts` set `coverage.provider='v8'`, `reportsDirectory='./coverage'`, reporters for `text-summary`, `lcov`, `html`; include production `src/**/*.{ts,tsx}`. Exclude tests/specs, `setupTests.ts`, `routeTree.gen.ts`, `*.d.ts`; do not exclude production modules lacking tests.
- [ ] **Step 5 — canonical npm scripts.** Add `test:coverage = vitest run --coverage` and `verify = npm run lint && npm run format:check && npm run test:coverage && npm run build && node scripts/assert-coverage.mjs`. `build` already runs `tsc -b`; no duplicate standalone `typecheck` needed. Keep `test = vitest run` and Playwright scripts unchanged. Ignore `/client/coverage/` in root `.gitignore`; confirm `git status` excludes generated reports.
- [ ] **Step 6 — verify.** Run Node checker tests; then `cd client && npm run verify`. Expected: exactly one Vitest run, lint/format/TS/build succeed, LCOV has source/line records for eligible TS/TSX and positive hits, HTML exists. Inspect that an existing untested production source appears with 0 hits, whereas `dist`, `*.test.*`, `*.spec.*`, setup/generated files do not count as production. Run `npm run test` separately only to confirm it remains a fast non-coverage entry point; do not add both commands to a single CI gate.
- [ ] **Step 7 — commit.** `git add client/vitest.config.ts client/package.json client/scripts/assert-coverage.mjs client/scripts/assert-coverage.test.mjs .gitignore` (plus lockfile only for proven dependency changes); commit `build(client): make V8 coverage part of verify`.

### Task 3: Preserve CI gates and run one combined scanner

**Files:** Modify `.github/workflows/ci.yml`; create root `sonar-project.properties`. No other workflow or build framework.

**Interfaces**
- Consumes: Task 1 `server/target/site/jacoco/jacoco.xml` + `server/target/classes/` and Task 2 `client/coverage/lcov.info`.
- Produces: existing successful `backend` and `frontend` checks and exactly one `sonarcloud` job on eligible pushes/same-repo PRs, with no tests in that job and explicit missing-input failure.

- [ ] **Step 1 — inspect scanner identity and baseline.** Confirm project key from [PR #60 SonarCloud check](https://sonarcloud.io/dashboard?id=krishna916_horizon&pullRequest=60): `krishna916_horizon`. Verify actual `sonar.organization` in SonarCloud before finalizing config (never invent it); read the current Quality Gate conditions and required GitHub status checks for later comparison. If settings cannot be inspected, stop at this external dependency and request owner-provided values. Verify official SonarSource scan action release is pinned (e.g., validated `v8.3.0` or commit SHA).
- [ ] **Step 2 — define root scan scope without narrowing existing reporting.** Create `sonar-project.properties` with project key/org, `sonar.sources=.`, `sonar.tests=server/src/test,client/src,client/e2e`; list `sonar.test.inclusions` for server tests, client `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, `**/*.spec.tsx` and Playwright tests. Define matching source exclusions so each test is indexed once; use Sonar's `**` syntax, **not brace expansion**. Exclude generated `client/src/routeTree.gen.ts` appropriately, and let Git ignore generated `target/`, `dist/`, `coverage/`. Keep tracked infrastructure, manifests, scripts and CI files eligible for static analysis. Configure exact paths `sonar.java.binaries=server/target/classes`, `sonar.coverage.jacoco.xmlReportPaths=server/target/site/jacoco/jacoco.xml`, `sonar.javascript.lcov.reportPaths=client/coverage/lcov.info`; no quality gate/exclusion shortcuts.
- [ ] **Step 3 — preserve backend/front checks; stage minimal inputs.** Leave backend's single `./mvnw -B -ntp verify` and Docker check unchanged. After success, check XML and `*.class` exist; stage to `$RUNNER_TEMP/sonar-input/server/target/site/jacoco/jacoco.xml` and `$RUNNER_TEMP/sonar-input/server/target/classes/`; upload that directory as `backend-sonar-input` (~7 days), using `if-no-files-found: error`. Keep separate on-failure Surefire report uploads. No HTML or credentials in backend job.
- [ ] **Step 4 — frontend CI uses canonical verification exactly once.** Replace independent `lint`/`format:check`/`test`/`build` steps with one `npm run verify`. After success, check LCOV; stage at `$RUNNER_TEMP/sonar-input/client/coverage/lcov.info` and upload as `frontend-sonar-input` (~7 days). Retain Chromium installation and `npm run test:e2e` as a separate step, not part of V8/Java coverage. Existing job must fail on missing reports.
- [ ] **Step 5 — scanner job and security.** Add `sonarcloud` with `needs: [backend, frontend]`, checked-out **same workflow commit** with `fetch-depth: 0`. Download each artifact by name to the repository workspace and assert exact expected paths; ensure artifacts contain `server/target/classes` (not just XML/LCOV). Use official SonarSource scan action once at repo root with `SONAR_TOKEN` only in scanner step, least-privilege token permissions. On internal PRs/push to master, missing `SONAR_TOKEN` yields a clear failure; on fork PRs, **skip scanner job** while keeping existing mandatory backend/frontend checks. Never use `pull_request_target`, untrusted script interpolation, or token echo.
- [ ] **Step 6 — RED path test without a second test pass.** With staged fixture artifact contents (or one temporary local file removal), prove scanner's preflight fails if `jacoco.xml`, `lcov.info`, or compiled `*.class` is missing. Check artifact directory structure before scanner. Test workflow syntax and fork expression via local lint/actionlint if available or GitHub workflow validation. Restore artifacts. Validate the scanner job contains **no** Maven test, npm test, npm verify or Playwright invocation.
- [ ] **Step 7 — scan diagnostic criteria.** On the first eligible CI scan (see Task 5 admin gate), inspect logs for **both** imported reports; confirm Java bytecode indexed; enumerate source/test files and confirm no indexing overlap or reduced static-analysis scope; check unresolved Java classpath warnings. If significant warnings occur, add exact Java library classpath in a narrow follow-up **within this task** without rerunning tests or replacing project scope. Any requirement to change rules/gates → stop and ask owner.
- [ ] **Step 8 — commit.** `git add .github/workflows/ci.yml sonar-project.properties`; commit `ci: import verification coverage into one SonarCloud analysis`. Note: test-matrix screenshots or SonarCloud reports cannot be declared passing until a real PR run occurs.

### Task 4: Document reproducibility and fix stale build guide

**Files:** Modify `DEV_SETUP.md` (and client/server AGENTS command pointers only if out of date).

**Interfaces**
- Consumes: final Task 1–3 commands and report paths.
- Produces: accurate maintainer procedure, including a clearly labeled **manual SonarCloud admin checkpoint**.

- [ ] **Step 1 — inspect doc expectations.** Compare `DEV_SETUP.md` instructions with current `ci.yml`; note it currently says Playwright is not in CI although it is. Confirm the recommended local backend command is `./mvnw -B -ntp verify`, frontend `npm run verify`; no SonarCloud credentials required.
- [ ] **Step 2 — write guide changes.** Document where XML/LCOV/HTML appear; distinction between `npm run test` fast and `npm run verify` complete; Testcontainers Docker prerequisite; one-shot CI artifact handoff; fork skip; SonarCloud secret setup, CI-based toggle and exact dashboard/log ingestion checks; missing/corrupt report troubleshooting; how an existing Quality Gate may change status when real data arrives. Correct Playwright claim. Keep instructions accurate for Unix and Windows where commands differ.
- [ ] **Step 3 — doc check.** Inspect repository-relative links; run the existing Prettier/Markdown applicable check if configured, verify copied commands match actual scripts. Avoid modifying `docs/ai` for this narrow change; if such edits become necessary, run `sync-docs-index` according to repo instructions.
- [ ] **Step 4 — commit.** `git add DEV_SETUP.md` and any genuinely necessary agent guide changes; commit `docs: explain coverage verification and SonarCloud migration`.

### Task 5: External SonarCloud migration, real PR/master validation and handoff

**Files:** No product-code files. Update the #61 issue/pr with verification evidence, operator checklist and blockers; do not write credentials into GitHub comments/docs.

**Interfaces**
- Consumes: Tasks 1–4 on feature branch plus owner-administered SonarCloud/GitHub configuration.
- Produces: PR + master evidence of real Java/TypeScript coverage import, no duplicate scanner/test pass, existing analysis reporting preserved; otherwise an explicit unfinished blocker.

- [ ] **Step 1 — prepare and present for owner review.** Open a PR for the reviewed branch only when owner directs; attach local verification commands/output, file list, and admin runbook. **Do not** disable Automatic Analysis, add `SONAR_TOKEN`, change Quality Gate or merge on your own.
- [ ] **Step 2 — owner-only admin checkpoint.** Ask owner to verify repository `SONAR_TOKEN` with execute-analysis permission, confirm project/org key and current gate/profile/new-code/required-check settings, then change SonarCloud **Administration → Analysis Method → Automatic Analysis OFF**. Record that this manual action completed; do not claim it from code.
- [ ] **Step 3 — actual PR scan.** Re-run PR workflow. Confirm backend/frontend independent green checks; single SonarCloud scan uploads analysis and imports both `jacoco.xml` + `lcov.info`; verify dashboard shows actual measurements for Java and TypeScript and source/test coverage maps to expected files. The new check should replace Automatic Analysis, not coexist. A red existing Quality Gate due to newly measured real coverage is **not** license to relax rules; disclose and ask.
- [ ] **Step 4 — security and failure-path audit.** Confirm fork PRs do not receive token/scanner, but still require regular checks. Check missing token behavior on eligible runs in a safe isolated scenario without publishing secrets. Ensure no test suite reruns in scanner and no HTML artifact bundles.
- [ ] **Step 5 — master validation.** Only after **owner-approved** merge, verify `master` receives one CI-based SonarCloud analysis with both coverage inputs and preserves existing project/reporting. If master validation cannot be performed in current work session, report its acceptance criterion as **pending**, not done.
- [ ] **Step 6 — final report.** Update issue with source links, executed command evidence, test counts, scanner import messages, coverage by language, quality gate state, any differences from pre-migration and remaining manual blockers. Do not close #61 until all acceptance criteria are genuinely satisfied.

## Self-Review / Acceptance Matrix

| Issue #61 requirement | Owning tasks | Required proof |
| --- | --- | --- |
| Backend `verify` emits JaCoCo XML/HTML + instruments Java 25 classes, preserves UTC/quality checks | 1 | Clean Maven run, file parse, real counters, JVM args, Testcontainers/SpotBugs/Spotless |
| Frontend full verify with coverage, no duplicate Vitest, valid HTML/LCOV and sane production denominator | 2 | Single Vitest run; checker fixtures; `npm run verify`; 0-hit production files included |
| CI independent backend/frontend and Playwright retained | 3 | GitHub Actions check/job logs |
| One combined analysis, report transfer, Java class bytecode and no test rerun | 3, 5 | Artifact tree and scanner log |
| Missing/corrupt report fails local build/CI | 1, 2, 3 | Negative fixture checks with actionable messages |
| SonarCloud PR and master real coverage in same project | 3, 5 | Actual SonarCloud analysis links, per-language metrics, no duplicate analysis |
| Least privilege, fork handling, local no token | 3, 5 | Workflow permissions/conditions, simulated missing-token path |
| Docs, Git ignores, no new mandatory threshold, unchanged Quality Gate | 2, 3, 4, 5 | Diff review, documented before/after gate comparison |

## Handoff / Stop Conditions

- **STOP** and consult owner on any uncovered material decision: changing SonarCloud Quality Gate, accepted static analysis scope, branch protection, coverage-percentage enforcement, scanner per-module policy, storing/exposing secrets, or introducing a new build framework.
- **Do not close issue** merely because reports exist locally. Real PR and `master` ingestion are separate acceptance steps.
- **No subagents**. Use `superpowers:executing-plans` inline, focused verification, small commits, and review every step before advancing.
- The branch currently contains **planning documentation only**; none of the plan's commands or CI/SonarCloud acceptance checks have been executed by this planning session.
