# Horizon Development Setup

This guide outlines how to set up your local development environment for Horizon.

## Prerequisites

- **Java:** OpenJDK 25 (Required for the backend)
- **NodeJS:** Node 20+ and npm 10+ (Required for the frontend)
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

Runs E2E integration tests:
```bash
cd client
npx playwright install
npm run test:e2e
```

## CI-Equivalent Checks (Before Opening a PR)

The required local checks use Java 25 for the backend and Node.js 24 for the frontend, matching the GitHub Actions runners. Node.js 20+ remains suitable for ordinary frontend development; use Node.js 24 when reproducing CI results. Backend verification also needs a running Docker daemon because repository and integration tests start PostgreSQL with Testcontainers.

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
npm run lint
npm run format:check
npm run test
npm run build
```

These npm commands mirror CI exactly. `npm ci` recreates `node_modules`, and `--ignore-scripts` disables dependency lifecycle scripts during installation. Backend tests use Testcontainers to start PostgreSQL, so Docker must be available; starting the app with `docker compose up` is not required for those tests. Docker Compose is still useful when running the application locally.

Pull requests targeting `master` and pushes to `master` run the same two independent jobs, named `backend` and `frontend`. Open the GitHub Actions run and select either job to inspect its steps and logs. On backend failure, check the run summary for the `backend-surefire-reports` artifact; it is uploaded when reports exist.

To retry a failed job, open **Actions → the failed run → Re-run failed jobs**. A canceled PR run means a newer run for that same PR replaced it; cancellation is not a test failure, so check that the latest PR commit has both job results. If a check fails, use its step logs and reproduce it with the commands above. Do not bypass a required check. These checks need no local credentials, `.env` file, repository secrets, or manually started PostgreSQL. Playwright is not part of this V1 CI gate; the E2E instructions above remain available for local use.

## IDE Settings & Extensions
- **VS Code:** Install recommended extensions: Extension Pack for Java, Spring Boot Extension Pack, ESLint, Prettier, Tailwind CSS.
- **IntelliJ IDEA:** Ensure Lombok plugin is enabled and annotation processing is active.
