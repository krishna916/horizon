# Horizon Development Setup

This guide outlines how to set up your local development environment for Horizon.

## Prerequisites

- **Java:** OpenJDK 25 (Required for the backend)
- **NodeJS:** Node 20+ and npm 10+ (Required for the frontend)
- **Docker:** Docker Desktop or Docker Engine with Docker Compose (Required for PostgreSQL)

## Local Development Setup

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

## IDE Settings & Extensions
- **VS Code:** Install recommended extensions: Extension Pack for Java, Spring Boot Extension Pack, ESLint, Prettier, Tailwind CSS.
- **IntelliJ IDEA:** Ensure Lombok plugin is enabled and annotation processing is active.
