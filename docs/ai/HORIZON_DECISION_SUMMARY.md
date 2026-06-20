# HORIZON_DECISION_SUMMARY

> [!NOTE]
> **Status:** Primary LLM Memory Document  
> **Purpose:** Ultra-compressed summary of accepted Horizon decisions. Intended as the first document future sessions should consume before consulting Product, Architecture, or Engineering Context.

---

# 1. Horizon Identity

## Product Category

```
Personal Productivity System
```

Focused on:
- Action Management
- Information Management

Not:
- PKM Platform
- Knowledge Graph
- Life Operating System
- Project Management Suite

---

## V1 Scope

- Home
- Today
- Inbox
- Tasks
- Notes
- Search
- Trash
- Tags
- Capture
- Archive

---

## V1 Non-Goals

- Goals
- Habits
- Projects
- Automation
- Analytics
- Collaboration
- Sharing
- Teams
- Knowledge Graph

---

# 2. Product Decisions

## Navigation

```
Home
Today
Inbox
-------------
Tasks
Notes
-------------
Settings
```

---

## Navigation Pattern

```
List ↓ Side Panel ↓ Full Page
```

Tasks and Notes behave identically.

---

## Search

- Capability
- Not Workspace

---

## Capture

```
Capture ↓ Inbox
```

---

## Inbox

- Review Queue
- Not Storage

Inbox is one-way.

---

## Archive

- Workspace Local

---

## Trash

- Global

---

## Tags

- Shared Across Tasks And Notes
- No Tag Workspace
- No Tag Hierarchy

---

# 3. Architecture Decisions

## Architecture Style

```
Spring Boot Modular Monolith
```

---

## Module Communication

```
module.api only
```

---

## Module Structure

- api
- web
- application
- domain
- infrastructure

---

## Domain Model

```
User
Task
 └─ ChecklistItem
Note
Tag
```

---

## Lifecycle Philosophy

```
Facts Over States
```

Use:
- `completed_at`
- `archived_at`
- `deleted_at`

Avoid:
- `status`
- `workflow_state`

---

## Ownership

```
Ownership = Authorization
```

---

## Security Boundary

- Repository-Level Ownership Enforcement

---

# 4. Persistence Decisions

## Database

- PostgreSQL

---

## Migrations

- Flyway

---

## Schema Ownership

```
Database Owns Schema
```

Hibernate validates only.

---

## IDs

```
Long BIGINT Identity
```

---

## Rich Content

```
JSONB
```

for:
- Task Description
- Note Content

---

## Inbox

- `BOOLEAN inbox`

---

## Tags

- Explicit Join Tables (`task_tag`, `note_tag`)

No polymorphic associations.

---

# 5. Backend Decisions

## Layering

```
web ↓ application ↓ domain
infrastructure ↑ application
```

---

## Application Services

- Command Service
- Query Service

per module.

---

## Transactions

```
One Use Case = One Transaction
```

---

## Shared Kernel

Keep minimal.

---

# 6. API Decisions

## Style

- Resource-Oriented REST

---

## Base Path

- `/api/v1`

---

## Resource Naming

- Plural

Examples:
- `/tasks`
- `/notes`
- `/tags`

---

## Updates

- `PATCH` preferred.

---

## Lifecycle Operations

- `POST /complete`
- `POST /archive`
- `POST /restore`
- `POST /reopen`

---

## DTOs

- Dedicated Request DTOs
- Dedicated Response DTOs

Never expose entities.

---

## Errors

- RFC 9457 Problem Details

---

## Pagination

- Deferred

---

# 7. Search Decisions

## Current Strategy

- Case-Insensitive `LIKE`

---

## Matching

- Tokenized Input
- AND Matching

---

## Ranking

- None

---

## Ordering

- `updated_at DESC`

---

## Ownership

- Search Coordinates
- Task Owns Task Search
- Note Owns Note Search

---

# 8. Security Decisions

## Authentication

- Session Authentication

---

## Session Storage

- Spring Session JDBC

---

## User Module

- Dedicated user module

---

## Current User

- `CurrentUserProvider`

---

## Non-Owned Resources

- `404 Not Found`

---

## Public Endpoints

- `/register`
- `/login`

Only. Everything else requires authentication.

---

# 9. Engineering Decisions

## Query Strategy

Preferred order:
1. Simple Repository Methods
2. Native SQL
3. Stored Procedures

Use JPQL sparingly.

---

## Naming

- `snake_case` database
- Singular modules
- Plural REST resources

---

## Testing Priority

1. Application Services
2. Repositories
3. Controllers

---

## AI-Friendly Development

Prefer:
- Explicit Structure
- Consistent Naming
- Simple Patterns
- Clear Ownership

Avoid:
- Magic
- Hidden Behavior
- Framework Cleverness

---

# 10. Deferred Decisions

## Product

- Goals
- Habits
- Projects
- Collaboration

---

## Search

- `pg_trgm`
- PostgreSQL FTS
- External Search

---

## Security

- OAuth
- JWT
- Mobile Authentication

---

## Architecture

- Background Jobs
- Caching
- Observability
- Eventing
- CQRS
- Microservices

---

# 11. Explicitly Rejected

## Architecture

- Microservices
- Event-Driven Architecture
- Spring Modulith
- CQRS

---

## Persistence

- Polymorphic Associations
- Generic Tag Assignment Tables
- Hibernate Schema Generation

---

## API

- RPC Endpoints
- Universal DTOs
- Header Versioning

---

## Security

- RBAC
- ACLs
- Permission Systems
- Organizations
- Teams

---

# 12. Reading Order

Future sessions should consult:
