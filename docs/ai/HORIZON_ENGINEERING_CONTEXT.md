# HORIZON*ENGINEERING*CONTEXT

> [!NOTE]
> **Status:** Authoritative Engineering Context
>
> **Purpose:** Compressed engineering standards and implementation guidance for Horizon. Defines coding conventions, architectural guardrails, development practices, and AI-assisted development rules.

---

# 1. Engineering Philosophy

## Primary Goals

Optimize for:

- Maintainability
- Clarity
- Consistency
- Developer Productivity
- Low Operational Complexity
- AI-Friendly Development
---

## Core Principles

- Simplicity First
- Modular Monolith First
- Earn Complexity
- Prefer Explicitness
- Prefer Readability Over Cleverness
- Prefer Boring Technology
- Optimize For Future Maintenance
---

## Project Context

- Solo Developer
- Hobby Project
- Cost Sensitive
- Rapid Iteration
- Long-Term Maintainability

Architecture should evolve incrementally.

---

# 2. Technology Stack

## Frontend

- React
- TypeScript
- Vite
- TanStack Router
- TanStack Query
- Shadcn UI
- Tailwind CSS
- TipTap
---

## Backend

- Java 21
- Spring Boot
- Spring Security
- Spring Data JPA
- Flyway
---

## Database

- PostgreSQL
---

## Search

- LIKE Search
- Future:
  - `pg_trgm`
  - PostgreSQL FTS
---

## Authentication

- Session Authentication
- Spring Session JDBC
---

# 3. Project Structure Principles

## Backend

Modules follow:

```
module
├── api
├── web
├── application
├── domain
└── infrastructure
```

---

## Ownership Rule

Modules own:

- Domain
- Persistence
- Application Services
- Controllers
- DTOs
---

## Cross-Module Rule

Communication occurs only through `module.api`.

---

# 4. Domain Modeling Rules

## Preferred

Model facts:

- `completed_at`
- `archived_at`
- `deleted_at`
---

## Avoid

Workflow state machines (Example: `TaskStatus`, `ReviewStatus`) unless clearly justified.

---

## Aggregate Design

Prefer:

- Aggregate Roots
- Child Entities
- Reference Aggregates

Avoid unnecessary inheritance.

---

## Identity

Use `Long IDs` throughout Horizon.

---

# 5. Persistence Rules

## Schema Ownership

Database owns schema. Use `Flyway` for all schema changes.

---

## Hibernate

- **Allowed:** Schema Validation
- **Not allowed:** Schema Generation
---

## Naming Conventions

### Tables

- `snake_case`
- `singular`

Examples: `task`, `note`, `tag`.

---

### Columns

- `snake_case`

Examples: `created_at`, `updated_at`, `user_id`.

---

### Constraints

- `pk_<table>`
- `fk_<table>_<table>`
- `uk_<table>_<columns>`
---

### Indexes

- `idx_<table>_<purpose>`
---

# 6. Query Strategy

## Preferred Query Order

### Level 1

Simple repository methods (Examples: `findByIdAndUserId()`, `findActiveByUserId()`).

---

### Level 2

Native SQL projections.

Preferred for:

- Complex Retrieval
- Cross-Table Queries
- Performance-Sensitive Queries
---

### Level 3

Stored Procedures. Allowed when:

- Significant Simplicity
- Significant Performance Benefit

exists.

---

## JPQL Philosophy

Use sparingly.

Preference:

- Simple Repository Methods
- Native SQL

over increasingly complex JPQL.

---

## Reasoning

- More Explicit
- More Predictable
- Closer To Database Reality
- Easier Performance Analysis
---

# 7. API Standards

## Style

Resource-Oriented REST

---

## Base Path

`/api/v1`

---

## Resource Naming

Plural Resources (Examples: `/tasks`, `/notes`, `/tags`)

---

## DTO Rules

Always use Request DTOs and Response DTOs. Never expose entities.

---

## Validation

### Controller

Shape validation.

### Application

Business validation.

### Domain

Invariant validation.

---

# 8. Error Handling

## Centralized Handling

Use `@RestControllerAdvice`

---

## API Errors

Use RFC 9457 Problem Details

---

## Exception Hierarchy

Prefer:

- `HorizonException`
- `NotFoundException`
- `ConflictException`
- `ValidationException`
- `AuthorizationException`
---

# 9. Security Rules

## Ownership

`Ownership = Authorization`

---

## Repository Enforcement

Ownership filtering belongs in repositories. Examples: `findByIdAndUserId()`

---

## Avoid

- Application-Level Ownership Checks
- Global ORM Filters
---

## Current User Access

Use `CurrentUserProvider`. Never `SecurityContextHolder` inside application services.

---

# 10. Frontend Standards

## Routing

Use `TanStack Router`

---

## Data Fetching

Use `TanStack Query`

---

## Server State

Belongs in Query Cache

---

## UI State

Belongs in React Components

---

## Forms

Prefer `React Hook Form` if complexity justifies it. Avoid unnecessary abstraction.

---

# 11. Testing Philosophy

## Priority Order

### Highest Value

Application Service Tests

---

### Medium Value

Repository Tests

---

### Lower Priority

Controller Tests

---

## Avoid

Excessive testing ceremony. Tests should provide confidence rather than coverage metrics.

---

# 12. Logging Philosophy

## Purpose

Logging exists for:

- Debugging
- Operational Visibility
- Failure Investigation
---

## Avoid

- Business Event Noise
- Excessive Trace Logging
- Framework Noise
---

## Preferred

Structured logging.

---

# 13. AI-Assisted Development Rules

## Goal

Codebase should remain AI-friendly.

---

## Prefer

- Predictable Structure
- Consistent Naming
- Explicit APIs
- Clear Ownership
- Simple Patterns
---

## Avoid

- Magic
- Hidden Behavior
- Excessive Indirection
- Framework Cleverness
---

## Documentation Rule

Important decisions should be documented. Future developers (human or AI) should not need to reverse engineer intent.

---

# 14. Deferred Until Needed

Do not introduce preemptively:

- Microservices
- CQRS
- Event Sourcing
- Message Queues
- Distributed Caches
- Background Job Frameworks
- Complex Observability Platforms
- Feature Flag Platforms

Complexity must be earned.

---

# 15. Context Usage Guidance

This document exists to provide:

- Implementation Standards
- Coding Conventions
- Technology Choices
- Engineering Guardrails

for future implementation sessions.

It intentionally excludes:

- Detailed ADR Content
- Detailed PRD Content
- Feature Specifications

which belong elsewhere.
