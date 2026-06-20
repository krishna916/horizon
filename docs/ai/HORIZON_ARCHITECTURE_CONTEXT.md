this# Horizon Architecture Context

> [!NOTE]
> **Status:** Authoritative Architecture Context  
> **Purpose:** Compressed architecture memory optimized for future Horizon architecture and implementation discussions. Captures accepted decisions, architectural boundaries, conventions, and evolution paths without ADR-level detail.

---

## 1. Architecture Principles

### Core Principles
* **Modular Monolith First:** Maintain a single deployment unit while strictly separating logical domains.
* **Simplicity First:** Actively avoid complexity; choose the simplest solution that satisfies the requirements.
* **Earn Complexity:** Do not introduce advanced architectural patterns until simpler ones fail to scale or meet needs.
* **Content First:** Structure the architecture around domain data and business content.
* **Facts Over States:** Focus on tracking events, timestamps, and factual changes rather than complex status machines.
* **Explicit Boundaries:** Keep modules isolated with clear communication contracts.
* **Future-Friendly Without Premature Abstraction:** Write clean, modular code that is easy to refactor without building unnecessary abstraction layers.

### Optimization Goals
The architecture is optimized to support:
* Developer Productivity
* Maintainability & Clarity
* Low Operational Complexity
* Incremental Evolution
* Solo Developer Ergonomics

---

## 2. System Architecture

### Application Style
* **Spring Boot Modular Monolith:** A single deployable application.
* **No Distributed Architecture / Microservices:** Avoid the operational overhead of multiple services.
* **No Event-Driven Architecture:** Communication is synchronous and direct where possible, minimizing asynchronous state tracking.

```
┌────────────────────────────────────────────────────────┐
│                      Spring Boot                       │
│                   Modular Monolith                     │
│                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Task Module  │  │ Note Module  │  │ Tag Module   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└────────────────────────────────────────────────────────┘
```

### Architectural Layers
Modules are structured using standard layered architecture, with strict downward-only dependencies:
```
Web
 └─► Application
      └─► Domain
           ▲
           │ (Implements)
Infrastructure
```

### Module Ownership & Isolation
Each module owns its complete stack:
* Domain Logic & Entities
* Application Logic & Services
* Persistence Logic & Repositories
* API Surface & HTTP Endpoints

> [!IMPORTANT]
> **Cross-Module Communication Rule:**
> Modules must communicate exclusively through their public API surface (`module.api`). Direct access to internal packages is strictly prohibited.

#### Strictly Prohibited:
* ❌ Cross-Module Repository Access
* ❌ Cross-Module Domain Access
* ❌ Cross-Module Infrastructure Access
* ❌ Cross-Module Application Service Access

---

## 3. Module Architecture

### V1 Modules
* **Domain Workspaces:**
  * `task` — Task and checklist management.
  * `note` — Rich-text note taking and logging.
* **Global Experiences:**
  * `home` — Unified dashboard experience.
  * `today` — Focus views for the current day.
  * `inbox` — Intake and triage capability.
* **Global Capabilities:**
  * `search` — System-wide search and retrieval.
* **Shared Concepts:**
  * `tag` — Categorization and cross-entity labeling.
* **Administration:**
  * `trash` — Soft-deletion management and cleanup.
* **Security:**
  * `user` — User accounts and authentication context.

### Standard Module Structure
Every module must conform to the following directory layout:
```text
module/
├── api/             # Public interfaces and shared contracts for other modules
├── web/             # Controllers, REST resources, and request/response DTOs
├── application/     # Application services, use cases, and transaction boundaries
├── domain/          # Aggregates, entities, value objects, and domain invariants
└── infrastructure/  # Persistence implementations, external clients, and configurations
```

---

## 4. Domain Model

### Aggregate Roots & Child Entities
* **Aggregate Roots:** `User`, `Task`, `Note`, `Tag`
* **Child Entities:**
  * `ChecklistItem` — Owned entirely by the `Task` aggregate root.

### Entity Relationships
| Source Entity | Target Entity | Relationship | Details / Join Table |
| :--- | :--- | :--- | :--- |
| `Task` | `ChecklistItem` | One-to-Many | Owned collection |
| `Task` | `Tag` | Many-to-Many | Via `task_tag` table |
| `Note` | `Tag` | Many-to-Many | Via `note_tag` table |

### Identity Strategy
* All entities use **Long** types for identifiers (`Long` in Java / `BIGINT` in PostgreSQL).

---

## 5. Ownership & Authorization Model

### Ownership Philosophy
> **Ownership = Authorization**
* Every primary resource is owned by a specific user.
* Access is granted solely based on resource ownership.

### Direct vs. Inherited Ownership
* **Direct Ownership:** Explicit owner columns on aggregate roots:
  * `Task.user_id`
  * `Note.user_id`
  * `Tag.user_id`
* **Inherited Ownership:** Child entities inherit ownership from their parent aggregate root:
  * `ChecklistItem` ──► `Task` ──► `User`

### Supported Authorization
* **Owner Access Only:** Users can only query, modify, or delete resources they explicitly own.
* **Explicitly Not Supported:**
  * ❌ Role-Based Access Control (RBAC)
  * ❌ Access Control Lists (ACLs) or granular Permissions
  * ❌ Organizations or Teams
  * ❌ Sharing and Collaboration features

---

## 6. Persistence Architecture

### Database & Migrations
* **Database:** PostgreSQL
* **Migration Tool:** Flyway
  * SQL-first migrations only.
  * Hibernate schema generation is disabled. Validation is active to ensure safety:
    ```properties
    spring.jpa.hibernate.ddl-auto=validate
    ```

### Conventions & Types
* **Identifier Generation:** `BIGINT GENERATED BY DEFAULT AS IDENTITY`
* **Timestamps:** Use `TIMESTAMPTZ` (always store as UTC, display relative to the local time zone).
* **Rich Content Storage:**
  * `Task.description` ──► stored as `JSONB`
  * `Note.content` ──► stored as `JSONB`

### Lifecycle Modeling
* Store lifecycle changes as factual timestamps rather than transitionary status enums:
  * `completed_at`
  * `archived_at`
  * `deleted_at`
* Avoid status state machines where possible.
* **Inbox Persistence:** Uses a `BOOLEAN inbox` flag (rather than a `reviewed_at` timestamp).
* **Priority Persistence:** Stored as `priority_id SMALLINT` and mapped to a Java enum in the application layer.

---

## 7. Database Schema Model

### Tables
* **Core Tables:** `task`, `checklist_item`, `note`, `tag`
* **Association Tables:** `task_tag`, `note_tag`

### Naming Conventions
* **Tables:** `snake_case`, singular form (e.g., `checklist_item`).
* **Columns:** `snake_case` (e.g., `completed_at`).
* **Foreign Keys:** `<entity>_id` naming convention (e.g., `task_id`).
* **Constraints:**
  * Primary Keys: `pk_<table>`
  * Foreign Keys: `fk_<table>_<referenced_table>`
  * Unique Keys: `uk_<table>_<columns>`
* **Indexes:** `idx_<table>_<purpose>`

---

## 8. Backend Service Architecture

### Application Services
Each module splits its application services to isolate side effects from reads:
* **Command Service:** Handles mutation operations (creates, updates, actions).
* **Query Service:** Handles retrieval and read-only operations.

*Example:* `TaskCommandService` vs. `TaskQueryService`

### Transaction Boundaries
> **One Use Case = One Transaction Boundary**
* **Commands:** Marked with `@Transactional` for automatic rollback on runtime exceptions.
* **Queries:** Marked with `@Transactional(readOnly = true)` for read optimization.

### Shared Kernel
The shared kernel must remain minimal and free of business logic.
* **Allowed:** `BaseEntity`, shared exceptions, and generic security/user abstractions.

---

## 9. API Architecture

### Style & Paths
* **API Style:** Resource-Oriented REST
* **Base Path:** `/api/v1`

### Resource Mapping
Resource names are mapped from singular modules to plural REST endpoints:
* `task` ──► `/api/v1/tasks`
* `note` ──► `/api/v1/notes`
* `tag`  ──► `/api/v1/tags`

### Operations
* **HTTP Methods:** `POST`, `GET`, `PATCH`, `DELETE`
* **Lifecycle Operations:** Explicit action endpoints instead of generic PATCH updates:
  * `POST /api/v1/tasks/{id}/complete`
  * `POST /api/v1/tasks/{id}/archive`
  * `POST /api/v1/tasks/{id}/restore`
  * `POST /api/v1/tasks/{id}/reopen`

### DTOs & Validation
* **DTO Strategy:** Always use dedicated request and response DTOs. Never expose database entities directly.
* **Validation Layers:**
  1. **Controller Layer:** Basic request payload validation.
  2. **Application Layer:** Business-rule validation.
  3. **Domain Layer:** Rigid invariant enforcement.

### Error Handling
* Unified handling using `@RestControllerAdvice`.
* **Error Contract:** Standard compliance with **RFC 9457 Problem Details**.

### Pagination
* **V1 Strategy:** Not implemented. Keep it simple and introduce pagination only when performance or payload size requires it.

---

## 10. Search Architecture

### Philosophy
* Search is a **Global Retrieval Capability** optimized for finding specific items, not a discovery engine.

### Search Scope
* **Tasks:** Matches on Title, Description, and Checklist Item Titles.
* **Notes:** Matches on Title and Content.

### Search Implementation
* **Technology:** Case-insensitive `LIKE` matching in SQL.
* **Query Processing:** Tokenized input terms joined by `AND` conditions.
* **Ordering:** Sorted by `updated_at DESC`.
* **Ranking:** No relevancy ranking algorithm.

### Module Interface
* The `search` module acts as a coordinator.
* Source modules own and execute their individual database query implementations via interfaces (`TaskQueryApi` and `NoteQueryApi`).

---

## 11. Security Architecture

### Authentication & Framework
* **Framework:** Spring Security
* **Session Strategy:** State-backed Session Authentication.
* **Session Storage:** Spring Session JDBC backed by PostgreSQL tables.
* **Authentication Provider:**
  * **Current:** Email + Password
  * **Future:** Google OAuth / GitHub OAuth

### Current User Resolution
* Application layers must fetch the active user context via a custom `CurrentUserProvider` bean.
* Do not access `SecurityContextHolder` directly outside the security configuration layers.

### Resource Protection
> [Premium Security Isolation]
> **Resource Isolation:**
> Attempting to access a non-existent resource or a resource owned by another user must return an HTTP `404 Not Found` (rather than a `403 Forbidden`) to avoid exposing resource existence.

---

## 12. Accepted Evolution Paths

To manage architectural complexity, technology upgrades must follow predefined progression paths, migrating only when demand justifies:

| Capability | Phase 1 (Current) | Phase 2 | Phase 3 | Phase 4 |
| :--- | :--- | :--- | :--- | :--- |
| **Search** | Case-insensitive `LIKE` | `pg_trgm` | PostgreSQL FTS | External Search |
| **Authentication** | Email + Password | OAuth Providers | JWT Tokens (if required) | — |
| **System Style** | Modular Monolith | — | — | — |

---

## 13. Explicitly Rejected For V1

The following patterns and features are intentionally excluded to maintain simplicity and speed:

* **Architecture:** Microservices, Event-Driven Architecture, CQRS, Distributed Systems, Spring Modulith.
* **Persistence:** Hibernate Schema Generation, Polymorphic Associations, Generic Tag Tables, Database Enums.
* **API:** RPC Endpoints, Universal/Shared DTOs, Custom Error Formats, Header-based Versioning.
* **Security:** Role-Based Access Control (RBAC), Access Control Lists (ACLs), explicit permission models, multi-tenant Organizations/Teams, sharing/collaboration logic.

---

## 14. Context Usage Guidance

This document serves as the primary source of architectural boundaries and accepted constraints:
* **Includes:** Decisions, conventions, structures, and evolution boundaries.
* **Excludes:** ADR history, alternatives debate, and granular technical justifications (which are maintained in the external architecture knowledge store).
