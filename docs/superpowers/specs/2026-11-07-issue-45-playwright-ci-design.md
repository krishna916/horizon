# Issue #45 — Independent Playwright Chromium CI Design

**Status:** Approved direction — Option A (2026-11-07).  
**Issue:** https://github.com/krishna916/horizon/issues/45 · **Parent epic:** #32.  
**Implementation branch:** `feature/45-playwright-ci`.  
**Reviewed baseline:** `master` at `7414dd9749bbd3f5b5a2228e9e69f1600e456858` (recheck for drift at implementation).

## Intent

Make the existing Playwright Chromium browser suite an independently identifiable GitHub Actions check on pull requests targeting `master` and pushes to `master`. Keep local E2E behavior unchanged and make browser failures diagnosable through short-lived Actions artifacts. This is an infrastructure change, not a new browser-testing framework or Task feature.

## Source alignment and boundaries

- **Authoritative issue:** #45. The live repository already runs Playwright, but currently under the `frontend` job.
- **Horizon Constitution:** prefer proven tools, minimal operational complexity, consistent testing, and existing conventions.
- **PRD-004 Tasks:** defines detail navigation and task workspace behavior covered by existing tests such as `client/e2e/task-detail.spec.ts`. This story changes only test execution plumbing. No task `status`, `completed_at`, archive, Inbox, tags, checklist, or other product semantics change.
- **Related PRDs/specs:** PRD-003 Inbox, PRD-002 Today, SPEC-001 Shared Concepts and SPEC-002 Tags likewise require no implementation modification.
- **Engineering instructions:** `Agents.md`, `client/AGENTS.md`, `.agents/skills/align-context/SKILL.md`, `docs/ai/INDEX.md`, ENG-002, `.agents/skills/testing-frontend/SKILL.md`, `DEV_SETUP.md`. Reference existing documentation rather than duplicating product rules.
- **Related work:** PR #44 added task detail browser checks; PR #62 introduced current coverage + SonarCloud topology. Preserve its verification and artifact contracts.

## Current repository (confirmed against baseline)

- `.github/workflows/ci.yml`: triggers on PRs and pushes to `master`, permissions `contents: read`, PR concurrency cancellation, and jobs `backend`, `frontend`, `sonarcloud`.
- `frontend`: `ubuntu-24.04`, Node 24, npm cache from `client/package-lock.json`, `npm ci --legacy-peer-deps --ignore-scripts`, `npm run verify`, Sonar LCOV staging/upload, **then** `npm run test:e2e:install` and `npm run test:e2e`. The latter two steps are the ones to move.
- `sonarcloud`: `needs: [backend, frontend]` with its existing same-repository PR / push security guard. Keep this dependency and guard unchanged.
- `client/package.json`: `test:e2e = playwright test`; `test:e2e:install = playwright install --with-deps chromium`; `@playwright/test` is version-pinned and the repo has a lockfile.
- `client/playwright.config.ts`: only `chromium`; Playwright starts Vite via `webServer` (`npm run dev`, localhost:5173); existing `reuseExistingServer: !process.env.CI`, CI retries 2, CI workers 1, `trace: 'on-first-retry'`, console `list` reporter.
- `client/e2e/`: existing tests intercept application APIs including user and Tasks requests; no real backend, database, credentials, or deployed environment is required.
- `DEV_SETUP.md`: knows Playwright runs in CI but describes it under the frontend job; documentation needs to reflect the separate job and artifacts.
- Root `.gitignore` already ignores `/client/test-results/` and `/client/playwright-report/`. No new ignore patterns needed.

## Approaches considered

| Approach | Trade-off | Decision |
| --- | --- | --- |
| Keep Playwright as a step in `frontend` | Least change, but failures obscure browser-specific status and block Sonar via frontend | Rejected: does not meet #45 |
| Add `playwright` job in existing `ci.yml` | Duplicates only Node/npm setup, but gives an independent check and preserves shared workflow triggers | **Selected** |
| Add separate `.github/workflows/playwright.yml` | Independent workflow, but duplicates triggers, permissions, and coordination for no V1 benefit | Rejected |

**Owner-approved Option A:** `playwright` has no `needs` dependency on `frontend` or `backend`. `sonarcloud` retains `needs: [backend, frontend]`, independent of whether Playwright passes. If browser tests fail while backend/frontend succeed, the Playwright check is red and SonarCloud is still eligible to run. An unrelated SonarCloud token/Quality Gate problem must be reported separately rather than “fixed” here.

## Implementation design

### CI job topology

```text
CI (pull_request -> master | push -> master)
  |-- backend -----------+
  |                      +--> sonarcloud (needs backend, frontend only)
  |-- frontend ----------+
  |
  +-- playwright (independent)
```

1. Remove the two Playwright steps from `frontend`; keep its verification, LCOV artifact staging, identity, timeout and runner behavior intact.
2. Add a sibling `playwright` job in the same workflow, name `playwright`, `runs-on: ubuntu-24.04`, `timeout-minutes: 30`, and `defaults.run.working-directory: client`.
3. Reuse checkout `actions/checkout@v7` with `persist-credentials: false`; `actions/setup-node@v6` with Node `24`, npm cache and `client/package-lock.json`; run `npm ci --legacy-peer-deps --ignore-scripts`; then the **existing** npm scripts `npm run test:e2e:install` and `npm run test:e2e`. Do not add a browser matrix, duplicated npm scripts, browser downloads to npm cache, or a backend service.
4. Preserve workflow-level `contents: read`, PR/push triggers and concurrency. No additional permissions, secrets, concurrency group, or status checks are configured in this issue.
5. Keep `sonarcloud` as currently written; explicitly verify no dependency on `playwright`.

### Failure diagnostics

- Preserve the current single Chromium project, Vite `webServer`, local server reuse behavior, CI retries/workers, and `trace: 'on-first-retry'`.
- Extend `client/playwright.config.ts` to use list + HTML reporters **in CI only**, with HTML `open: 'never'`. Preserve local `reporter: 'list'`. Enable `screenshot: 'only-on-failure'` for actionable failed assertions without successful-run screenshots.
- Keep Playwright's conventional `client/playwright-report/` and `client/test-results/` output paths. Do not introduce videos or custom reporting infrastructure.
- At the end of the new job, use existing `actions/upload-artifact@v7` **only on failure**, with `path:` containing both repository-root-relative paths `client/playwright-report/` and `client/test-results/`, `retention-days: 7`, `if-no-files-found: ignore`. A setup failure may have no artifacts; CI logs remain the fallback. Do not upload any browser artifacts on success.
- Keep GitHub Actions `upload-artifact` as a workflow step, not a Playwright reporter dependency. Avoid capturing application secrets in screenshots or traces; current E2E API fixtures are mocked.

### Documentation and verification

- Update `DEV_SETUP.md` in place: local `cd client && npm ci --legacy-peer-deps --ignore-scripts && npm run test:e2e:install && npm run test:e2e`; Playwright's Vite auto-start; no Docker, backend, DB or secrets; CI job names and SonarCloud dependency; where to download failure artifact, `npx playwright show-report` / `npx playwright show-trace` for downloaded diagnostics; note that the E2E job does not contribute to Vitest/Sonar unit coverage.
- Local verification: run existing E2E command and `npm run verify` where feasible; lint/check config/YAML without introducing a repository dependency.
- GitHub-hosted verification: on an implementation PR to `master`, `backend`, `frontend`, and `playwright` appear separately. Validate successful browser run. On an isolated **disposable branch/PR**, introduce one intentionally false Playwright assertion, observe only `playwright` failing, verify failure artifacts downloadable, and verify `sonarcloud` remains eligible after backend/frontend succeed. Delete the disposable branch/change afterward; never retain an intentional failure in the implementation branch.
- Do not edit branch protection or make Playwright a required check automatically; #45 explicitly defers required-check policy.

## Risks and review points

1. **Actual CI depends on existing npm flags:** `npm ci` must keep `--legacy-peer-deps --ignore-scripts` rather than silently “simplifying” installation.
2. **Artifact paths are relative to the Actions workspace root**, not the job's `working-directory`. Prefix uploaded directories with `client/`.
3. **Trace availability is retry-dependent:** `on-first-retry` supplies traces for retries; HTML and failure screenshots cover failures even when a trace is absent.
4. **A new check does not imply a new required check:** owner decides branch protection after job stability.
5. **Existing SonarCloud unrelated red checks** (token, analysis method, Quality Gate) must not be mistaken for an E2E dependency failure.
6. **Work from latest master:** avoid reverting or duplicating recent #61/#62 CI changes.

## External references

- [Playwright CI guidance](https://playwright.dev/docs/ci)
- [Playwright browser installation](https://playwright.dev/docs/browsers)
- [Playwright HTML reporters](https://playwright.dev/docs/test-reporters)
- [GitHub Actions needs semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs)

**Handoff:** The accompanying task-level plan is `../plans/2026-11-07-issue-45-playwright-ci.md`. Luna implements **inline, without subagents**, after owner review and on this feature branch, then opens a PR for review rather than merging autonomously.
