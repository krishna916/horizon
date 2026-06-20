# BOOT-001 Repository Bootstrap

|Status|Version|Date|
|:--|:--|:--|
|Accepted|1.0|2026-06-20|

---

# Context

Horizon has completed its planning phase.

Accepted artifacts include:

- Product Specifications
    
- ADR-001 UI Foundations
    
- ADR-002 Domain Model
    
- ADR-003 Persistence Architecture
    
- ADR-004 Backend Architecture
    
- ADR-005 API Architecture
    
- ADR-006 Search Architecture
    
- ADR-007 Security & Ownership
    
- ADR-008 Frontend Architecture
    
- ENG-001 Engineering Guidelines
    
- IMP-001 Implementation Roadmap
    

The project is now transitioning from planning into implementation.

This document defines the initial repository bootstrap required to begin development.

It intentionally establishes only the minimum technical foundation necessary to implement **M0 — Architecture Validation**.

No business functionality is introduced by BOOT-001.

---

# Purpose

Create a clean, maintainable, AI-friendly implementation foundation that allows Horizon development to begin immediately.

BOOT-001 should establish:

- Repository structure
    
- Technology initialization
    
- Local development environment
    
- Build tooling
    
- Testing foundation
    
- Continuous integration
    

without introducing unnecessary infrastructure or business code.

---

# Guiding Principles

## Minimal Bootstrap

Only create infrastructure that is immediately required.

Avoid speculative setup.

---

## Feature-Driven Infrastructure

Infrastructure exists to support implementation.

Features should never wait for infrastructure that is not immediately necessary.

---

## Vertical Slice Readiness

The repository should be capable of immediately implementing the first M0 feature after BOOT-001 is complete.

---

## Infrastructure Freeze

If a feature can be implemented without introducing new infrastructure:

**Implement the feature first.**

Infrastructure complexity must be earned.

---

# Repository Structure

The repository follows a simple monorepo structure.

```text
horizon/
├── backend/
├── frontend/
├── docs/
├── docker/
├── scripts/
├── .github/
├── .gitignore
├── README.md
└── docker-compose.yml
```

---

## Responsibilities

### backend/

Spring Boot application.

Owns:

- Domain modules
    
- REST API
    
- Persistence
    
- Security
    

---

### frontend/

React application.

Owns:

- UI
    
- Routing
    
- Client-side state
    
- HTTP clients
    

---

### docs/

Architecture documentation.

Includes:

- ADRs
    
- Engineering Guidelines
    
- Implementation Documents
    
- Product Specifications
    

---

### docker/

Docker-related assets.

Examples:

- PostgreSQL initialization
    
- Local development configuration
    

---

### scripts/

Developer utilities.

Examples:

- Build helpers
    
- Local development scripts
    

---

### .github/

Continuous integration workflows.

---

# Backend Bootstrap

Initialize a Spring Boot project using:

- Java 21
    
- Maven Wrapper
    
- Spring Boot
    
- Spring Security
    
- Spring Data JPA
    
- Flyway
    
- Spring Session JDBC
    
- Validation
    
- PostgreSQL Driver
    

---

## Initial Module Structure

```text
user/
task/
note/
tag/
search/
home/
today/
inbox/
trash/
shared/
```

Each module follows the established architecture:

```text
module/
├── api/
├── application/
├── domain/
├── infrastructure/
└── web/
```

No business implementation is added during BOOT-001.

---

## Shared Module

The shared module remains intentionally minimal.

Allowed examples:

- BaseEntity
    
- Shared exceptions
    
- Security abstractions
    
- CurrentUserProvider
    

Business logic must remain inside owning modules.

---

# Frontend Bootstrap

Initialize a Vite React TypeScript application.

Install:

- React
    
- TypeScript
    
- TanStack Router
    
- TanStack Query
    
- Axios
    
- Tailwind CSS
    
- Shadcn UI
    
- React Hook Form
    
- Zod
    
- Lucide React
    

---

## Initial Structure

```text
src/
├── app/
├── shared/
├── user/
├── task/
├── note/
├── tag/
├── inbox/
├── today/
├── home/
├── search/
└── trash/
```

Each feature module owns:

- Components
    
- Routes
    
- API clients
    
- Query definitions
    
- Forms
    
- Types
    

No feature implementation is introduced.

---

# Database Foundation

Horizon standardizes on PostgreSQL.

The same database technology is used across:

- Local development
    
- Integration testing
    
- Production
    

Embedded databases are intentionally not used.

---

## Local Development

Local development uses:

- Docker Compose
    
- PostgreSQL
    
- Flyway
    

Developers should not manually create databases.

---

## Integration Testing

Integration tests use:

- PostgreSQL
    
- Testcontainers
    

Repository behavior should always be validated against PostgreSQL.

---

## Unit Testing

Unit tests should not depend on a database.

Use mocks or fakes where appropriate.

---

## Initial Schema

Only schema required for M0 should be created.

Examples:

- users
    
- spring_session
    
- spring_session_attributes
    

Task, Note, Tag and other application tables are deferred until their implementation begins.

---

# Local Development

The project should be runnable using only:

1. Start PostgreSQL
    

```bash
docker compose up -d
```

2. Start backend
    

```bash
./mvnw spring-boot:run
```

3. Start frontend
    

```bash
npm run dev
```

No additional local infrastructure is required.

---

# Testing Foundation

Testing infrastructure should exist before feature development begins.

---

## Backend

Install:

- JUnit 5
    
- Spring Boot Test
    
- Mockito
    
- Testcontainers
    

---

## Frontend

Install:

- Vitest
    
- React Testing Library
    
- Playwright
    

---

## Testing Philosophy

Preferred testing pyramid:

1. Unit Tests
    
2. Application Service Tests
    
3. Repository Tests
    
4. Integration Tests
    
5. End-to-End Tests
    

Repository and integration tests should execute against PostgreSQL using Testcontainers.

---

# Build Tooling

## Backend

Use:

- Maven Wrapper
    

Future tooling is intentionally deferred:

- Checkstyle
    
- SpotBugs
    
- ErrorProne
    

---

## Frontend

Use:

- npm
    
- ESLint
    
- Prettier
    

Formatting should be automated where practical.

---

# Continuous Integration

BOOT-001 establishes a minimal CI pipeline.

Pipeline responsibilities:

Backend:

- Build
    
- Execute tests
    

Frontend:

- Install dependencies
    
- Build
    
- Execute tests
    

Deployment automation is intentionally deferred.

---

# Repository Standards

## Branch Strategy

Use:

```text
main
feature/*
```

Branches should remain short-lived.

---

## Commit Strategy

Commits represent completed intent.

Preferred:

- Add user registration endpoint
    
- Configure Flyway migrations
    
- Initialize React application
    

Avoid:

- WIP
    
- Fix
    
- More changes
    

---

## Documentation

Documentation should evolve alongside implementation.

Update documentation when changing:

- Architecture
    
- Public APIs
    
- Engineering conventions
    
- Module boundaries
    
- Domain model
    

---

# Developer Documentation

Create:

```text
README.md
```

containing:

- Project overview
    
- Technology stack
    
- Repository layout
    
- Startup instructions
    
- Build commands
    
- Test commands
    

Create:

```text
DEV_SETUP.md
```

containing:

- Required software
    
- Java version
    
- Node version
    
- Docker requirement
    
- IDE recommendations
    
- Troubleshooting
    

---

# Definition of Done

BOOT-001 is complete when a developer can:

- Clone the repository
    
- Start PostgreSQL
    
- Execute Flyway migrations
    
- Start the backend
    
- Start the frontend
    
- Execute backend tests
    
- Execute frontend tests
    
- Pass the CI pipeline
    
- Begin implementing M0 without adding new infrastructure
    

---

# Explicitly Out of Scope

BOOT-001 does **not** implement:

- User registration
    
- Login
    
- Authentication
    
- Authorization
    
- Business modules
    
- REST endpoints
    
- Domain entities
    
- Application services
    
- Repository implementations
    
- Search
    
- Tasks
    
- Notes
    
- Inbox
    
- Home
    
- Today
    
- Production deployment
    
- Monitoring
    
- Caching
    
- Message queues
    
- Feature flags
    
- Background processing
    

These concerns are introduced incrementally through subsequent implementation milestones.

---

# Result

Completion of BOOT-001 provides a fully initialized development foundation capable of supporting Horizon's first implementation milestone:

```text
M0 — Architecture Validation

Register
↓
Login
↓
Current User
↓
Session Management
```

At the conclusion of BOOT-001, no further infrastructure work should be required before implementation of M0 begins.

Future implementation should proceed using Horizon's accepted development philosophy:

```text
Vertical Slice First

Thin Slice Delivery

Working Software Over Layer Completion

Done > Perfect
```