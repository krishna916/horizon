# Backend Agent Guidelines (server/)

Spring Boot application targeting **Java 25** and **Spring Boot 4.0.6**.

*Refer to the following references for core backend architecture standards:*
*   *Testing Rules: [ENG-001 Section 12](file:///D:/projects/my-horizon/docs/ai/ENG-001%20Engineering%20Guidelines%20v1.0.md#L638)*
*   *Security & Ownership model: [HORIZON_ARCHITECTURE_CONTEXT.md #5](file:///D:/projects/my-horizon/docs/ai/HORIZON_ARCHITECTURE_CONTEXT.md#L129)*

## Core Tech Stack & Libraries

- **Spring Boot Starters:** Web MVC, Security, Data JPA, Actuator, Flyway, JDBC, Test, Session JDBC.
- **Session & Security:** State-backed Session Authentication via **Spring Session JDBC** in PostgreSQL.
- **Database:** PostgreSQL 17 (container port 5432 mapped to host port 5433).
- **Flyway:** SQL-only migrations under `src/main/resources/db/migration/`. Hibernate schema generation is disabled (`validate` only).
- **Testcontainers:** Repository integration tests use PostgreSQL Testcontainers.

## Commands

Run these from the `server/` directory:

```bash
./mvnw spring-boot:run      # start backend (requires PostgreSQL running on host port 5433)
./mvnw test                   # run all tests (JUnit + Testcontainers)
./mvnw test -Dtest=MyTest     # run a single test class
```
Note: On Windows, use `./mvnw.cmd` instead of `./mvnw`.

## Conventions

- **Module Directory Layout:**
  ```text
  module/
  ├── api/             # Public API and contracts for other modules
  ├── web/             # Controllers and request/response DTOs (never expose entities)
  ├── application/     # Services (Command/Query split), Transaction boundaries
  ├── domain/          # Aggregates, entities, value objects, and domain invariants
  └── infrastructure/  # Persistence implementations and configurations
  ```
- **Factual Timestamps:** Model aggregates using `completed_at`, `archived_at`, `deleted_at` rather than workflow state machines.
- **JSONB:** Rich content (e.g., descriptions or note body) is stored as JSONB.
- **Current User Context:** Use `CurrentUserProvider` in application services; never access `SecurityContextHolder` directly.
- **API Format:** Resource-oriented REST, plural resource names (e.g., `/tasks`), RFC 9457 Problem Details for errors.
