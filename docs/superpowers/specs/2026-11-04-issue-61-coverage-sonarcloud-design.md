# Issue #61 — Build Coverage and SonarCloud CI Migration Design

**Status:** Proposed design for owner review; CI-based analysis approach approved 2026-11-04. **Issue:** [#61](https://github.com/krishna916/horizon/issues/61) · **Parent:** [#32](https://github.com/krishna916/horizon/issues/32) · **Branch:** \`feature/61-test-coverage-sonarcloud\`.  
**Baseline:** \`master\` commit \`bb493c0c075d52929b9e568da83cee58e7ed3b47\` as inspected 2026-11-04. Recheck before execution.

## Intent and authoritative boundaries

Fix the gap revealed by [PR #60](https://github.com/krishna916/horizon/pull/60): SonarCloud reported 0.0% new-code coverage despite 235 backend tests and 474 frontend tests. The objective is trustworthy measurement, not to drive up a metric. Coverage must be a routine by-product of local/CI verification, and SonarCloud must ingest reports from **the same test executions** without running the suites again.

**Relevant sources:** [Issue #61](https://github.com/krishna916/horizon/issues/61); \`Agents.md\`, \`server/AGENTS.md\`, \`client/AGENTS.md\`; \`docs/ai/INDEX.md\`; \`docs/ai/ENG-001 Engineering Guidelines v1.0.md\` (Coverage Philosophy: no mandatory target); \`docs/ai/ENG-002 - Frontend Engineering Guide.md\`; \`DEV_SETUP.md\`; Horizon Constitution, Status and Implementation Workflow; \`docs/ai/HORIZON_DECISION_SUMMARY.md\`. \`PRD-004 Tasks\`, \`PRD-003 Inbox\`, \`SPEC-001 Shared Concepts\` and \`SPEC-002 Tags\` were cross-checked: this issue modifies build/analysis plumbing, **not** Task status, lifecycle, Inbox or tags. Their feature rules remain unchanged. The current code wins over stale status prose: implementation is **Java 25 / Spring Boot 4.0.6**, not Java 21.

### Owner-approved decisions

1. Migrate the **existing** \`krishna916_horizon\` SonarCloud project from **Automatic Analysis (currently ON)** to **CI-based Analysis**, with a coordinated manual switch after coverage implementation is ready for validation; do not switch immediately.
2. Keep the existing SonarCloud project, Quality Gate, quality profiles, new-code definition and reporting history; do **not** lower, disable or replace rules. An existing gate can become red when real coverage is imported; report this rather than silently changing policy.
3. No new mandatory percentage threshold. Correct report production, transport and ingestion is the success criterion.
4. No test reruns for Sonar; independent backend/frontend CI checks and separate Playwright browser tests continue.
5. No automatic PR merging or deployment changes. Owner confirms changes before Luna implements; Luna executes **inline without subagents**.

### Non-goals

No Task/Note product changes, dependencies in application production code, monorepo build framework, JaCoCo minimum coverage percentage, broad exclusion of production files, rewrite of existing static-analysis checks, extra SonarCloud project, scanner per module, uploading HTML reports into CI by default, or SonarCloud dependency in local builds.

## Current repository and root cause

- \`server/pom.xml\`: Maven \`verify\`, Spotless (validate), SpotBugs (verify), Error Prone (compiler), Surefire \`<argLine>-Duser.timezone=UTC</argLine>\`. No JaCoCo.
- \`client/package.json\`: \`vitest\` and \`@vitest/coverage-v8\` both declared at \`^2.1.8\` (verify lockfile versions); \`test\` is \`vitest run\`; no canonical \`verify\` script.
- \`client/vitest.config.ts\`: no coverage configuration. \`client/vite.config.ts\` has Vite 8 + React/compiler integrations; preserve.
- \`.github/workflows/ci.yml\`: independent \`backend\` Maven verify and \`frontend\` lint, format, unit tests, build, Playwright. No report handoff or scanner. GitHub shows SonarCloud as a separate third-party check; its PR #60 check completed before backend/frontend.
- \`.gitignore\` currently omits \`/client/coverage/\`. \`DEV_SETUP.md\` is the existing build guide; its claim that Playwright is not run in CI is stale.
- **Confirmed by project owner:** Automatic Analysis is ON. It cannot import JaCoCo/LCOV, so the workflow must be migrated at the administrative checkpoint.

## Considered approaches

| Approach | Trade-off | Decision |
| --- | --- | --- |
| Keep Automatic Analysis and generate local coverage only | Least effort; SonarCloud still cannot import reports | Rejected: fails #61 |
| One combined GitHub Actions verification+scan job | Easiest report paths, but loses independent backend/frontend results and repeats setup | Rejected: violates CI ergonomics requirement |
| Keep separate verification jobs; download XML, LCOV and Java bytecode into one downstream root-level scan | Small artifact handoff and careful paths required; preserves independent gates and runs tests only once | **Selected** |

A root-level SonarScanner CLI/GitHub Action is a pragmatic choice for one SonarCloud project analyzing both Maven Java and Vite TypeScript. SonarSource normally recommends its Maven scanner for Java; however, a Maven-root scan in \`server/\` would need extra handling to analyze \`client/\` outside the Maven project. Here, CLI is accepted **provided Java compiled classes are supplied and analysis warnings are reviewed**. Do not sacrifice Java analyzer correctness merely to simplify this topology.

## Design

\`\`\`text
backend CI: ./mvnw -B -ntp verify
    ├─ existing checks/tests (once)
    ├─ JaCoCo XML: server/target/site/jacoco/jacoco.xml
    ├─ JaCoCo HTML: server/target/site/jacoco/index.html (local)
    └─ artifact: XML + server/target/classes (+ test bytecode if configured)
                                  ┐
                                  ├─ sonarcloud CI (same commit, one scan)
                                  │    ├─ checkout full Git history
                                  │    ├─ fetch both artifacts
                                  │    ├─ check files/class bytecode
                                  │    ├─ scanner imports JaCoCo + LCOV
                                  │    └─ GitHub/SonarCloud receives results
                                  ┘
frontend CI: npm run verify
    ├─ ESLint, Prettier, TypeScript/Vite build
    ├─ Vitest unit/component tests (once, with V8 coverage)
    ├─ LCOV: client/coverage/lcov.info
    ├─ HTML: client/coverage/index.html (local)
    └─ artifact: LCOV only
Playwright: existing separate frontend CI step (no backend Java coverage claim)
\`\`\`

### A. Backend verification contract

- Pin stable Java 25-compatible \`org.jacoco:jacoco-maven-plugin:0.8.16\` (released 2026-10-24; verify compatibility on the actual build); \`prepare-agent\` before Surefire, \`report\` during \`verify\`, XML and HTML enabled. Do not change Testcontainers/PostgreSQL, plugin ordering that controls Spotless/SpotBugs, or compiler/Error Prone settings.
- Update Surefire configuration to **late evaluation** \`<argLine>@{argLine} -Duser.timezone=UTC</argLine>\` (and preserve any existing additional JVM args). Do not use plain \`\${argLine}\` interpolation, which can miss the late agent modification. Confirm the forked test JVM includes both the JaCoCo \`-javaagent\` and UTC timezone.
- The normal \`./mvnw verify\` (no \`sonar:sonar\` or external token) must produce \`target/jacoco.exec\` plus well-formed, nonempty JaCoCo XML and browsable HTML. Add a small Maven-native fail-fast post-report validation during \`verify\`: check missing, empty, malformed XML and absence of any coverage counters/classes; fail with an actionable error. Prefer a minimal Ant task (\`maven-antrun-plugin\`) over introducing external shell/Python/Node requirements for a Java build. A covered-line count sanity check is allowed as an **instrumentation check**, not as a percentage quality gate.
- Preserve \`mvn test\` as a fast test workflow; full reporting is guaranteed by \`verify\`. Do not invoke \`verify\` twice in CI.

### B. Frontend verification contract

- Keep \`npm run test\` as \`vitest run\`; add \`test:coverage\` = \`vitest run --coverage\`. Set \`test.coverage.provider='v8'\` in \`vitest.config.ts\`, with \`lcov\`, \`html\` and helpful console reporter.
- Include production \`src/**/*.{ts,tsx}\` in the coverage denominator (not only test-imported files) and exclude only test/spec files, setup scripts, declaration files and generated router files. Avoid exclusions for components, hooks or feature modules just because they lack tests. Confirm Vitest 2.x syntax and exact dependency versions from \`package-lock.json\`.
- Add \`npm run verify\` as the **one authoritative frontend full verification**: lint, format check, Vitest once with coverage, TypeScript/Vite production build, then a small Node report validator. \`npm run build\` already runs \`tsc -b\`, so a second \`npm run typecheck\` is unnecessary. Verify \`lcov.info\` contains source (SF) and line (DA) records with nonzero measured execution and HTML exists; malformed/missing reports fail \`verify\` clearly. No new runtime dependency.
- Keep Playwright as a separate CI step after the canonical unit/build gate. Ignore \`/client/coverage/\` in Git; do not upload HTML in routine CI.

### C. SonarCloud analysis contract

- Keep GitHub Actions jobs named \`backend\` and \`frontend\` (PR checks stay independently diagnosable). After successful verification, upload short-lived (~7-day) minimal artifacts: backend JaCoCo XML and compiled \`server/target/classes\`; frontend LCOV. Use stable staging/destination paths; assert report existence before uploading. No credentials in either verification job.
- Add **one** \`sonarcloud\` job with \`needs: [backend, frontend]\` and checkout with \`fetch-depth: 0\`. Download artifacts for the **same workflow run / commit** and reconstruct exactly:
  \`server/target/site/jacoco/jacoco.xml\`, \`server/target/classes/**\`, \`client/coverage/lcov.info\`.
- \`sonar-project.properties\` at the repository root owns scan configuration. Existing project key \`krishna916_horizon\` is evidenced by the GitHub SonarCloud check. Verify the **organization key in SonarCloud project settings** before committing its value; never guess credentials. Use:
  - \`sonar.coverage.jacoco.xmlReportPaths=server/target/site/jacoco/jacoco.xml\`
  - \`sonar.javascript.lcov.reportPaths=client/coverage/lcov.info\`
  - \`sonar.java.binaries=server/target/classes\`
  - \`sonar.sources=server/src/main/java,client/src\` and \`sonar.tests=server/src/test/java,client/src\`, with **disjoint** inclusions/exclusions so frontend \`*.test.ts(x)\`/\`*.spec.ts(x)\` files index as tests, not production, and no file indexes twice. Do not blanket-exclude untested production code. Confirm paths and indexed-file counts from scanner output.
- Java analysis quality caveat: scanner CLI requires compiled class files and may warn on unresolved dependencies. First run with classes; inspect analyzer logs. If significant unresolved type/classpath warnings occur, supply an exact Maven dependency classpath without rerunning tests (e.g. reuse verified build's dependencies/cache). **Do not silently accept degraded Java static analysis.**
- Use an official SonarSource scan action pinned to a known release/commit. \`SONAR_TOKEN\` exists **only** in the scanning job; add least-privilege read permissions (\`contents: read\`, and \`pull-requests: read\` if needed), avoid \`pull_request_target\`. Local \`verify\` requires no SonarCloud network or secrets.
- Run scanner for \`push\` to \`master\` and **same-repository** PRs to \`master\`. Untrusted fork PRs still run backend/frontend mandatory checks but **skip the secret-bearing scan**; never send secrets to fork code. On eligible internal PRs/pushes, missing \`SONAR_TOKEN\` must cause an actionable failure, not a silent green or skip. If any branch protection requires a scanner on forks, surface the conflict to owner; do not downgrade security.
- Scanner submission and Quality Gate are distinct: a scan job can submit successfully while SonarCloud's existing Quality Gate reports failure. Keep current SonarCloud gate untouched. Do not set \`sonar.qualitygate.wait\` or modify branch protection without owner decision.

### D. Manual migration and verification

1. **Before toggle:** Luna makes coverage/build/CI/config changes, confirms backend + frontend local commands and one-test-run behavior. The pre-toggle PR may show the old Automatic Analysis check while the new scanner cannot yet run; this is expected during migration, **not proof of ingestion**.
2. **Owner checkpoint (approved method, not an automation):** Verify that GitHub repository secret \`SONAR_TOKEN\` is configured with project analysis permission and SonarCloud organization/project key is correct. Record existing Quality Gate conditions, profiles, new-code definition and required GitHub checks. In SonarCloud **Administration → Analysis Method**, set Automatic Analysis to **OFF**. Do this only when ready to immediately re-run the new CI scanner. Never claim this admin change was made by a code PR.
3. **PR validation:** Re-run/refresh PR workflow after switch; inspect logs for JaCoCo and LCOV imports and Java bytecode indexing, compare Java and TypeScript local coverage to dashboard and distinguish actual uncovered code from missing import. Confirm new PR check decoration without duplicate analysis. Existing gate might turn red on actual newly measured coverage; document, do not automatically relax.
4. **Master validation:** After owner-approved merge, confirm one CI scan for \`master\`, same project history/quality standards, correct overall and per-language measures. Only then consider issue #61 done. If admin permissions/secret settings prevent validation, document blocker and leave criterion open.

### Verification and failure cases

- Missing/empty/corrupt backend XML and frontend LCOV fail **normal full verification**, with concrete file names in the error; exercise failure path without leaving intentional sabotage in a commit.
- JaCoCo agent must actually instrument executed Java application classes; missing agent but empty/all-zero output must not masquerade as successful coverage.
- V8 measurement includes eligible production TS/TSX files, including untested ones; compiled \`dist\`, generated code, tests and setup files do not inflate production totals.
- Test count and execution count remain comparable to baseline; no extra Maven/Vitest pass in scanner. Playwright remains independent.
- CI never serves secrets to fork PRs, never uploads HTML bundles, and reliably reconstructs report paths; scanner fails explicitly on absent artifact or missing internal-PR token.
- SonarCloud dashboard reports metrics for both languages, not simply a populated but unassociated file. Existing static-analysis findings are not silently lost via scope exclusions.

### Known risks / owner-visible checkpoints

- **Quality Gate change in observed result**: real coverage may activate an existing new-code coverage condition and fail; do not change it inside #61. The owner decides any policy revision later.
- **SonarCloud administrative toggle**: operator-only manual step; a branch PR alone cannot finish acceptance.
- **Different scope from Automatic Analysis**: compare indexed Java/TS files and Quality Gate criteria; generated/test paths may be reclassified, not quietly excluded.
- **Java scanner classpath**: compiled bytecode is required, and library resolution needs log validation.
- **Docs drift**: update \`DEV_SETUP.md\` with actual current Playwright CI behavior and canonical commands; keep \`docs/ai/INDEX.md\` unchanged unless altering files under \`docs/ai/\` (then run \`sync-docs-index\`). This issue doesn't justify a Constitution amendment.

## External documentation consulted

- [SonarQube Cloud: test coverage overview](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/overview)
- [SonarQube Cloud: Java/bytecode requirements](https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/languages/java)
- [SonarQube Cloud: JavaScript/TypeScript LCOV](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/javascript-typescript-test-coverage)
- [SonarQube Cloud: analysis scope](https://docs.sonarsource.com/sonarqube-cloud/managing-your-projects/project-analysis/setting-analysis-scope/setting-initial-scope)
- [JaCoCo releases: Java 25 support](https://www.jacoco.org/jacoco/trunk/doc/changes.html)
- [Official SonarSource GitHub Action](https://github.com/SonarSource/sonarqube-scan-action)
- [GitHub: fork PR secret handling](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)

**Open administrative facts to confirm at execution:** SonarCloud organization key, exact existing Quality Gate conditions, available GitHub \`SONAR_TOKEN\`, and required GitHub checks. No owner-level product decision is assumed beyond the approved migration and unchanged policy.
