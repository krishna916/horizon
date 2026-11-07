# Horizon Development Setup

This guide outlines how to set up your local development environment for Horizon.

## Prerequisites

- **Java:** OpenJDK 25 (Required for the backend)
- **Node.js:** Node.js 24 and npm 10+ (Required for frontend development and verification)
- **Docker:** Docker Desktop or Docker Engine with Docker Compose (Required for PostgreSQL)

## Local Development Setup

### Quick Start (All Services)

You can launch the PostgreSQL container, Spring Boot backend, and React client concurrently using the quick-start scripts:

- **Linux/macOS (or Git Bash on Windows):** Run `./start.sh` from the repository root.
- **Windows (PowerShell):** Run `.\start.ps1` from the repository root.
- **Windows (Command Prompt / Double-click):** Run `start.bat` from the repository root.

Alternatively, you can run the services individually as outlined below:

### 1. Database Configuration

Horizon uses PostgreSQL 17. The database port is mapped to `5433` on the host to avoid conflicts with other local Postgres instances.

Start the PostgreSQL container:

```bash
cd server
docker compose up -d
```

### 2. Backend API Setup

The backend is a Spring Boot application running on Java 25.
Flyway migrations run automatically on startup.

To run the backend:

```bash
cd server
./mvnw.cmd spring-boot:run
```

On Unix-based operating systems, use `./mvnw` instead. The API runs on `http://localhost:8081`.

### 3. Frontend Setup

The frontend is a Vite + React + TypeScript application.

To install dependencies and start the client:

```bash
cd client
npm install
npm run dev
```

The developer server runs on `http://localhost:5173`.

## Test Execution

### Backend Tests

Runs all unit and integration tests:

```bash
cd server
./mvnw.cmd test
```

### Backend Testing Standards & Constraints

- **No H2 Database:** H2 is not used for testing to prevent differences in SQL dialects/behavior.
- **PostgreSQL via Testcontainers:** All repository and integration tests run against a real PostgreSQL instance using Testcontainers.
- **Docker Dependency:** Running backend tests requires a running local Docker daemon to orchestrate the Testcontainers.

### Frontend Tests

Runs unit tests:

```bash
cd client
npm run test
```

Runs the Chromium E2E suite. Playwright starts the Vite test server from its existing configuration; the scenarios intercept API requests, so no backend, PostgreSQL, Docker, or secrets are needed:

```bash
cd client
npm ci --legacy-peer-deps --ignore-scripts
npm run test:e2e:install
npm run test:e2e
```

The `test:e2e:install` script installs Chromium and its Linux dependencies. Local development keeps the existing Playwright reporter and server reuse behavior.

## CI-Equivalent Checks (Before Opening a PR)

The local full-verification commands use Java 25 for the backend and Node.js 24 for the frontend, matching the GitHub Actions runners. Backend verification also needs a running Docker daemon because repository and integration tests start PostgreSQL with Testcontainers.

From the repository root, run the backend gate:

```bash
cd server
docker info
./mvnw -B -ntp verify
```

On Windows, use `.\mvnw.cmd -B -ntp verify` instead of `./mvnw -B -ntp verify` (run `docker info` from the same directory first). `verify` is the CI gate; it runs Maven's configured verification lifecycle, not only `mvn test`.

In a separate terminal, also from the repository root, run the frontend gate:

```bash
cd client
npm ci --legacy-peer-deps --ignore-scripts
npm run verify
```

`npm ci` recreates `node_modules`, and `--ignore-scripts` disables dependency lifecycle scripts during installation. `npm run verify` runs ESLint, Prettier, Vitest once with V8 coverage, the TypeScript/Vite production build, and a report check. `npm run test` remains the fast unit-test command without coverage. Playwright runs as a separate Chromium job and does not contribute to Vitest or SonarCloud unit coverage. It uses the existing [`client/playwright.config.ts`](client/playwright.config.ts) and the same local commands shown above.

Full verification writes these local reports:

- Backend JaCoCo: `server/target/site/jacoco/jacoco.xml` and `server/target/site/jacoco/index.html`.
- Frontend V8: `client/coverage/lcov.info` and `client/coverage/index.html`.

The report directories are generated outputs and are ignored by Git. Maven `verify` checks the execution data, XML, HTML, and covered-line instrumentation. Frontend `verify` checks that LCOV contains source and line records with measured execution and that the HTML report is readable. Neither command needs a SonarCloud token or SonarCloud network access. Backend tests use Testcontainers to start PostgreSQL, so Docker must be available; starting the app with `docker compose up` is not required for those tests. Docker Compose remains useful when running the application locally.

Pull requests targeting `master` and pushes to `master` run independently named `backend`, `frontend`, and `playwright` jobs. The frontend job runs `npm run verify`; the Playwright job installs Chromium and runs `npm run test:e2e` on its own runner. The `sonarcloud` job still depends only on `backend` and `frontend`, downloads their seven-day coverage artifacts, and scans the same workflow commit. Fork pull requests keep running the three verification jobs while the secret-bearing SonarCloud job is skipped.

When the Playwright job fails, it uploads the `playwright-failure-diagnostics` artifact with the HTML report, failure screenshots, and any retry traces. The artifact is retained for seven days; successful Playwright runs do not upload browser diagnostics. To inspect it, open the failed GitHub Actions run, select the `playwright` job, and download `playwright-failure-diagnostics` from the run's Artifacts section. Extract it, then from `client/` open the report with `npx playwright show-report playwright-report`. Open a trace with `npx playwright show-trace test-results/<test-result-directory>/trace.zip` when that test retry produced a trace.

## SonarCloud CI Migration Checkpoint

The existing SonarQube Cloud project is `krishna916_horizon` in organization `krishna916`. Its current analysis mode is Automatic Analysis. Do not change the analysis method until the code and workflow are ready and the owner confirms the project settings.

Before the coordinated switch, the owner should:

1. Confirm the organization/project keys, the project's new-code definition, the current Quality Gate and profiles, and the required GitHub checks. The project information reviewed on 2026-11-04 showed the `Sonar way` Quality Gate and `Sonar way comprehensive` profiles. The gate included a new-code coverage condition of at least 80%; reconfirm these settings before switching.
2. Configure the GitHub repository secret `SONAR_TOKEN` with project analysis permission. The token is used only in the eligible `sonarcloud` job. Missing token on a same-repository PR or `master` push fails that job with an actionable message.
3. When ready to immediately rerun the scanner workflow, open **SonarQube Cloud → Administration → Analysis Method** and turn **Automatic Analysis OFF**. This is a manual owner action; a code change cannot perform it.
4. Rerun the workflow for a same-repository PR. Check that the logs import `server/target/site/jacoco/jacoco.xml` and `client/coverage/lcov.info`, index Java bytecode from `server/target/classes`, and show both Java and TypeScript coverage. Compare the dashboard with the local reports and review any Java classpath warnings.
5. After an owner-approved merge, verify one CI-based analysis on `master` and confirm the same project history and Quality Gate remain in use.

Real coverage may make the existing Quality Gate fail if new code is below its current threshold. Report that result without changing the gate, profiles, or new-code definition as part of this issue. Keep the PR and `master` ingestion checks open until their scanner logs and dashboards confirm both languages were measured.

If a report is missing locally, rerun the relevant full-verification command and read the file-specific validator error. If scanner preflight reports a missing artifact, inspect the `backend` or `frontend` job and verify its report staging step succeeded in the same workflow run. A successful submission alone is not proof of coverage ingestion; confirm both imported report paths and the resulting per-language measures.

Open the GitHub Actions run and select either verification job to inspect its steps and logs. On backend failure, check the run summary for the `backend-surefire-reports` artifact; it is uploaded when reports exist.

To retry a failed job, open **Actions → the failed run → Re-run failed jobs**. A canceled PR run means a newer run for that same PR replaced it; cancellation is not a test failure, so check that the latest PR commit has the expected job results. If a check fails, use its step logs and reproduce it with the commands above. Do not bypass a required check. Local verification needs no credentials, `.env` file, repository secrets, or manually started PostgreSQL.

## IDE Settings & Extensions

- **VS Code:** Install recommended extensions: Extension Pack for Java, Spring Boot Extension Pack, ESLint, Prettier, Tailwind CSS.
- **IntelliJ IDEA:** Ensure Lombok plugin is enabled and annotation processing is active.
