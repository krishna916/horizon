# Horizon

Horizon is a personal productivity platform built using React 19 and Spring Boot 4.

## Project Structure
- `client/`: React 19 client application (Vite, Tailwind v4, TanStack Query/Router).
- `server/`: Spring Boot 4.0.6 backend (Java 25, Data JPA, PostgreSQL, Flyway).
- `docs/`: Product specifications and architecture decision records.

## Quick Start
To launch the database, backend, and frontend concurrently, run:

On Unix-based operating systems (Linux/macOS) or Windows (Git Bash):
```bash
./start.sh
```

On Windows (PowerShell):
```powershell
.\start.ps1
```

On Windows (Command Prompt / Double-click):
```cmd
start.bat
```

For step-by-step installation instructions, dependencies, and troubleshooting, refer to [DEV_SETUP.md](DEV_SETUP.md).

## Running Tests
- Backend: Run `./mvnw.cmd test` inside `server/` (on Windows) or `./mvnw test` (on Unix).
- Frontend Unit: Run `npm run test` inside `client/`.
- Frontend E2E: Run `npm run test:e2e` inside `client/`.
