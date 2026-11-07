# Issue #45 — Independent Playwright Chromium CI Implementation Plan

> **For Luna (agentic worker): REQUIRED SUB-SKILL: `superpowers:executing-plans`. Execute inline, task-by-task; no subagents. Keep each checkbox current, capture RED/GREEN evidence and commit focused changes. Read the approved design first. Do not implement until the owner approves this plan.**

**Goal:** Move the existing Playwright Chromium suite into an independent GitHub Actions job with useful failure artifacts, without changing app behavior or local E2E workflows.

**Architecture:** Retain one `.github/workflows/ci.yml` and add an independent `playwright` job next to `backend` and `frontend`. Keep SonarCloud dependent only on `backend` and `frontend`. Reuse the pinned npm toolchain and existing Playwright configuration, adding only CI failure diagnostics.

**Tech Stack:** GitHub Actions on `ubuntu-24.04`; `actions/checkout@v7`, `actions/setup-node@v6`, `actions/upload-artifact@v7`; Node.js 24, npm, Vite 8, Playwright `@playwright/test@1.61.0` (from current `package.json`), Chromium, TypeScript.

**Spec:** [Approved design](../specs/2026-11-07-issue-45-playwright-ci-design.md) · [Issue #45](https://github.com/krishna916/horizon/issues/45).

## Global Constraints

- Implementation branch: `feature/45-playwright-ci`; originally forked from `master` SHA `7414dd9749bbd3f5b5a2228e9e69f1600e456858`. Re-fetch latest `master` before editing, reconcile any CI drift, and preserve unrelated commits.
- **Owner decision (approved 2026-11-07): Option A.** `playwright` is independent; `sonarcloud` must keep `needs: [backend, frontend]`, regardless of Playwright outcome.
- Read `Agents.md`, `client/AGENTS.md`, `.agents/skills/align-context/SKILL.md`, `.agents/skills/testing-frontend/SKILL.md`, `docs/ai/INDEX.md`, `DEV_SETUP.md` and the design. Consult ENG-002 and source PRD-004 where relevant. Existing code, not stale HORIZON_STATUS stack values, establishes Node 24/Java 25 baseline.
- Keep current `backend`, `frontend`, and `sonarcloud` checks, existing SonarCloud artifact production/downloads, fork PR secret guard, global workflow permissions/triggers/concurrency, and frontend `npm run verify` unchanged in behavior.
- Never add application endpoints, DB/Testcontainers to browser job, secrets, new npm dependencies, a browser/device matrix, coverage thresholds, or modifications to task lifecycle/status, Inbox, Tags or Checklist behavior.
- Do not make `playwright` a required status check, edit repository branch protection, open unrelated administrative issues, merge, or bypass existing checks. Report any external administrative blocker to owner.
- Use Superpowers testing-first and verification-before-completion discipline. Inline execution only; **do not dispatch subagents**.

## File Map and Interfaces

| File | Responsibility |
| --- | --- |
| `.github/workflows/ci.yml` | Remove browser steps from `frontend`; add `playwright` job with correct permissions, setup, independent failure handling and artifact upload |
| `client/playwright.config.ts` | Keep local Vite/Chromium behavior; add CI HTML report and failure screenshots while retaining trace behavior |
| `DEV_SETUP.md` | Update canonical local commands, four-check CI topology and failure artifact retrieval |

No source-feature files, `package.json`, `package-lock.json`, Sonar config, backend files, or `docs/ai/INDEX.md` should change. If a genuinely required change falls outside this map, document why and ask owner before changing scope.

**Dependency flow:** Task 1 produces the independent CI job. Task 2 adds failure diagnostics to it. Task 3 documents and validates the resulting flow, including a temporary failing PR check. Each task owns an observable, reviewable deliverable.

## Review Focus

The plan must explicitly verify these failure modes, not just the happy path:

1. **Locked npm install:** `npm ci --legacy-peer-deps --ignore-scripts` on the clean GitHub runner succeeds using `client/package-lock.json`; ordinary `npm ci` is not silently substituted.
2. **Vite isolation:** Playwright launches its configured localhost:5173 `webServer` and mocked APIs without a backend, Docker, or secrets; `reuseExistingServer` remains true only outside CI.
3. **Failure evidence:** A failing browser assertion causes nonzero E2E exit; report, screenshot and trace (when retry trace is available) can actually be downloaded from the failed run.
4. **Job independence:** Failing `playwright` does not fail/skips `frontend` or `backend`; `sonarcloud` remains eligible when its two prerequisites pass.
5. **No unintended CI behavior changes:** Retained `master` PR/push triggers, global permissions/concurrency and Sonar report staging; successful Playwright runs upload no browser diagnostic artifact.

---

### Task 1: Extract Playwright into a standalone CI job

**Files:** Modify `.github/workflows/ci.yml`.

**Interfaces**
- Consumes: existing `client/package-lock.json`, `npm run test:e2e:install`, `npm run test:e2e`, `client/playwright.config.ts`.
- Produces: named independent job `playwright`, with exit code from the complete existing Chromium suite; unchanged `backend`/`frontend` verification and `sonarcloud` prerequisites.

- [ ] **Step 1 — Establish RED baseline.** Read `.github/workflows/ci.yml` and record that it contains no `jobs.playwright` but does contain `Install Chromium for Playwright` and `Run Playwright browser tests` inside `frontend`. Record `sonarcloud.needs` before edits. This establishes the missing acceptance behavior; do not misinterpret existing browser execution as a separate job.
- [ ] **Step 2 — Preserve frontend verification.** Remove **only** the two browser-related steps from `frontend`; leave `npm run verify`, LCOV staging, frontend artifact upload, Node/npm caching, permissions and timeout intact.
- [ ] **Step 3 — Implement the independent job.** Add `jobs.playwright` as a sibling to `frontend` and `sonarcloud`, `name: playwright`, `runs-on: ubuntu-24.04`, `timeout-minutes: 30`, and `defaults.run.working-directory: client`. Steps in order: checkout `actions/checkout@v7` with `persist-credentials: false`; setup `actions/setup-node@v6` with `node-version: "24"`, `cache: npm`, `cache-dependency-path: client/package-lock.json`; install `npm ci --legacy-peer-deps --ignore-scripts`; execute `npm run test:e2e:install`; execute `npm run test:e2e`. Do **not** set `needs` on this job.
- [ ] **Step 4 — Static GREEN verification.** Inspect workflow structure: exactly one Playwright install step and one E2E execution step, both in `playwright`; `frontend` has no Playwright command and retains one `npm run verify`; `sonarcloud` still has `needs: [backend, frontend]`; triggers remain PR/push to `master`. Run `git diff --check` and `actionlint .github/workflows/ci.yml` if locally installed (otherwise let GitHub parse the workflow on PR; do not add a new repo dependency just for linting).
- [ ] **Step 5 — Verify baseline locally when browser dependencies are available.** Run in `client/`: `npm ci --legacy-peer-deps --ignore-scripts`, `npm run test:e2e:install`, then `npm run test:e2e`. Expect full Chromium suite passing using Playwright-managed Vite `webServer`, without a running backend/DB. If local Linux dependencies are unavailable, record the limitation; require hosted-runner proof in Task 3 rather than asserting success.
- [ ] **Step 6 — Commit.** Stage only `.github/workflows/ci.yml` and commit `ci: separate Playwright browser checks from frontend verification`.

### Task 2: Add failure-only Playwright diagnostics

**Files:** Modify `client/playwright.config.ts` and `.github/workflows/ci.yml`.

**Interfaces**
- Consumes: Task 1 `playwright` job and existing `on-first-retry` trace configuration.
- Produces: `client/playwright-report/index.html` on CI runs and `client/test-results/` failure outputs, uploaded as one seven-day GitHub artifact only on CI failure.

- [ ] **Step 1 — RED diagnostic baseline.** Note `reporter: 'list'` and no screenshot setting in current config; check that `playwright` job currently has no failure artifact step. Existing `on-first-retry` traces alone do not satisfy retrievable CI artifacts.
- [ ] **Step 2 — Configure CI diagnostics minimally.** In `client/playwright.config.ts`, keep `testDir`, projects, `baseURL`, `webServer`, `fullyParallel`, `forbidOnly`, `retries`, `workers`, and trace unchanged. Change `reporter` to `process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list'`; set `use.screenshot: 'only-on-failure'`. Do not enable video or change local reporter. Rely on default `playwright-report` and `test-results` directories.
- [ ] **Step 3 — Upload on failure.** Append to `playwright` job: `name: Upload Playwright diagnostics on failure`, `if: failure()`, `uses: actions/upload-artifact@v7`, `with.name: playwright-failure-diagnostics`, `with.path` multiline `client/playwright-report/` and `client/test-results/`, `if-no-files-found: ignore`, `retention-days: 7`. These paths are repository-root relative even though `run.working-directory` is `client`. Never use `always()` or upload successful-run diagnostics.
- [ ] **Step 4 — GREEN diagnostic probe.** On a disposable local test file **not staged/committed**, run a single test that visits `/login` (or another existing public route) then asserts a deliberately wrong condition. With `CI=true` and localhost:5173 free, run that test using the existing E2E command with a Playwright file filter. Expect nonzero exit, HTML report output and at least one failure screenshot; inspect a retry trace when present. Ensure `PLAYWRIGHT_HTML_OPEN` is not launching a browser in CI. Remove the probe and verify `git status` contains no transient test or generated report. A local diagnostic run is supplementary to the GitHub artifact acceptance check in Task 3.
- [ ] **Step 5 — Normal regression.** Run `npm run test:e2e` normally to prove the local reporter and existing browser tests remain functional; run `npm run format:check` and `npm run lint` from `client/`. Ensure root `.gitignore` already excludes Playwright output; do not change it.
- [ ] **Step 6 — Commit.** Stage only `client/playwright.config.ts` and `.github/workflows/ci.yml`; commit `ci: upload short-lived Playwright failure diagnostics`.

### Task 3: Document and prove independent CI outcomes

**Files:** Modify `DEV_SETUP.md`. No additional persistent test files.

**Interfaces**
- Consumes: Tasks 1–2 job and artifact contract.
- Produces: reproducible local/CI instructions and a PR with verified positive/negative GitHub Actions evidence, with disposable failure test fully removed.

- [ ] **Step 1 — RED documentation check.** Find the existing references in `DEV_SETUP.md` saying the frontend job runs Playwright. Identify missing explanations for independent `playwright` status, failure-only artifacts and artifact inspection.
- [ ] **Step 2 — Update the guide.** Describe from `client/` the exact `npm ci --legacy-peer-deps --ignore-scripts`, `npm run test:e2e:install`, and `npm run test:e2e` commands; note Vite auto-starts and current intercepted APIs mean no backend/PostgreSQL/Docker/secrets. Clarify that E2E tests run in `playwright` independently of `frontend`, and `sonarcloud` still needs only `backend` and `frontend`. Link to existing `client/playwright.config.ts` using repository-relative Markdown URLs. Describe Actions -> run -> `playwright` -> `playwright-failure-diagnostics` artifact download, seven-day retention, and local opening of downloaded HTML report/traces via Playwright CLI. Successful runs do not upload browser diagnostics.
- [ ] **Step 3 — Local review.** Run `git diff --check`; check repo-relative documentation links; inspect that only the three planned implementation files changed across Tasks 1–3. Confirm no app code, test fixtures, dependencies, scripts, status models, permissions, required-check policies or Sonar configuration were edited. Run `npm run verify` from `client/` if feasible; it must remain the same frontend gate as before.
- [ ] **Step 4 — Commit documentation.** Stage only `DEV_SETUP.md`; commit `docs: explain independent Playwright CI and failure artifacts`.
- [ ] **Step 5 — Hosted positive-path check.** Open an implementation PR from `feature/45-playwright-ci` to `master` with #45 linked, **without merging**. Inspect GitHub Actions: `backend`, `frontend`, and `playwright` appear as separately identifiable jobs. Confirm clean runner uses Node 24, npm cache, `npm ci --legacy-peer-deps --ignore-scripts`, Chromium installation and all E2E specs. Confirm no Playwright artifact on successful run and SonarCloud depends on its two intended jobs. Record commit/run URLs and test counts, not just local claims.
- [ ] **Step 6 — Hosted RED isolation check.** Create a **separate disposable branch/PR targeting `master`**, based on the implementation branch. Add a small intentionally failing browser assertion only there. Let workflow run and record: `playwright` check **fails**; `backend` and `frontend` continue independently; `sonarcloud` is eligible to run if its two prerequisites pass (an existing SonarCloud configuration failure is unrelated); failure diagnostics artifact exists and contains report and screenshots/trace when applicable. Download it, inspect HTML and at least one failure attachment. Close disposable PR and delete disposable branch afterward; the feature branch and its history must contain no intentional failure. If GitHub lacks permission for a disposable PR, report the blocked acceptance check explicitly—do not replace it with unsupported success claims.
- [ ] **Step 7 — Final review.** Ensure no leaked tokens/credentials, workflow action versions match repo conventions, no unintended files/CI jobs added, `sonarcloud.needs` unchanged, PR scope limited to #45, and no required-check/branch-protection updates. Review against issue acceptance criteria and the approved design, listing verified vs blocked criteria. Request owner review; do not merge autonomously.

## Definition of Done

- [ ] CI `playwright` job executes all existing Chromium E2E tests on PRs targeting `master` and pushes to `master`.
- [ ] `backend`/`frontend` checks and Sonar report staging are unchanged; `sonarcloud.needs` remains `[backend, frontend]`.
- [ ] No backend, DB, secrets, new browser matrix, CI-only test script or dependency needed.
- [ ] Failure-only artifact with report + failure attachments is downloadable and retained seven days.
- [ ] Local `npm run test:e2e` behavior remains valid.
- [ ] Disposable failing assertion proves independent red Playwright result, and is absent from implementation branch.
- [ ] `DEV_SETUP.md` accurately documents workflow and artifact inspection.
- [ ] Required-check policy and SonarCloud settings unchanged; implementation PR awaits owner review and merge decision.

## Luna handoff

Read in order: [issue #45](https://github.com/krishna916/horizon/issues/45), [design](../specs/2026-11-07-issue-45-playwright-ci-design.md), this plan, `Agents.md`, `client/AGENTS.md`, `DEV_SETUP.md`, and relevant indexed guidance. Continue on `feature/45-playwright-ci` (use a worktree if available), execute with **`superpowers:executing-plans` inline without subagents**, and report precise test and CI evidence. **Do not change the approved Option A dependency model**, broaden scope, or merge automatically. Escalate only new material conflicts that cannot be settled from the current accepted context.
