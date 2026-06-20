# ARCHITECTURE_OVERVIEW

# Horizon Architecture Overview

## Horizon Overview

### What Is Horizon?

Horizon is a personal productivity system focused on two core domains:

```text
Action Management
+
Information Management
```

The platform is designed around four primary activities:

```text
Capture
Review
Execution
Retrieval
```

Rather than attempting to become a comprehensive life-management platform, Horizon focuses on helping users reliably manage tasks, notes, and daily commitments with minimal friction.

---

### Product Scope

Horizon V1 includes:

#### Core Experiences

- Home
- Today
- Inbox
- Tasks
- Notes
- Search
- Trash

#### Core Capabilities

- Capture
- Tags
- Archive
- Search
- Recovery

---

### V1 Goals

- Frictionless Capture
- Reliable Daily Execution
- Action Management
- Information Management
- Fast Retrieval
- Strong Foundation for Future Growth

---

### Explicit Non-Goals

The following are intentionally excluded from V1:

- Goals
- Habits
- Projects
- Domains
- Automation
- Analytics
- Recommendations
- Knowledge Graph Features
- PKM Features
- Backlinks
- Collaboration
- Sharing
- Teams
- Organizations

---

# Architecture Principles

Horizon is guided by a small set of architectural principles.

### Modular Monolith First

The system is implemented as a single deployable application with clearly separated domain modules.

### Simplicity First

Prefer the simplest solution that satisfies current requirements.

### Earn Complexity

Advanced patterns, infrastructure, and abstractions are introduced only when justified by real needs.

### Explicit Over Clever

Readable, predictable code is preferred over framework magic and clever abstractions.

### AI-Friendly Development

The project structure prioritizes discoverability, consistency, and explicit ownership to support both human and AI-assisted development.

### Facts Over States

Lifecycle information is modeled using factual timestamps rather than complex workflow state machines.

Examples:

```text
completed_at
archived_at
deleted_at
```

instead of:

```text
status
workflow_state
```

---

# System Architecture

## High-Level Architecture

```text
┌─────────────────────────────┐
│          Frontend           │
│ React + TypeScript + Vite   │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│         REST API            │
│       Spring Boot           │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│     Modular Monolith        │
│                             │
│ user   task   note   tag    │
│ search inbox  today  home   │
│ trash                       │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│         PostgreSQL          │
└─────────────────────────────┘
```

---

## Major Technologies

### Frontend

- React
- TypeScript
- Vite
- TanStack Router
- TanStack Query

### Backend

- Java 21
- Spring Boot
- Spring Security
- Spring Data JPA

### Database

- PostgreSQL
- Flyway

---

# Technology Stack

## Frontend

- React
- TypeScript
- Vite
- TanStack Router
- TanStack Query
- Axios
- React Hook Form
- Zod
- Shadcn UI
- Tailwind CSS

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

# Module Map

## user

Owns user accounts, authentication, session identity, and current-user context.

---

## task

Owns task management and checklist functionality.

Primary aggregate:

```text
Task
 └─ ChecklistItem
```

---

## note

Owns note creation, storage, editing, and retrieval.

Represents Horizon's information management capability.

---

## tag

Owns user-defined categorization shared across tasks and notes.

Tags are independent entities and may be attached to multiple content types.

---

## search

Provides global retrieval across Horizon.

Coordinates search requests while delegating content-specific search implementation to owning modules.

---

## inbox

Provides the review queue for newly captured content.

Answers:

```text
What have I captured but not reviewed?
```

---

## today

Provides the daily execution experience.

Answers:

```text
What requires my attention today?
```

---

## home

Provides awareness and status visibility.

Answers:

```text
How am I doing?
```

---

## trash

Provides recovery and permanent deletion workflows.

Acts as Horizon's global safety net.

---

# Frontend Architecture Summary

### Feature-Oriented Modules

Frontend structure mirrors backend domain boundaries whenever practical.

```text
task/
note/
tag/
search/
...
```

Each module owns its own:

- Components
- Routes
- Forms
- API Clients
- Types
- Query Definitions

---

### Functional React Components

Horizon standardizes on modern functional React components and React Hooks.

Class components are not used for new development.

---

### Server State

Server state is owned by TanStack Query.

Examples:

- Tasks
- Notes
- Tags
- Search Results
- Current User

---

### UI State

UI state belongs in React components using:

- useState
- useReducer

Examples:

- Dialog visibility
- Side panels
- Expanded sections

---

### No Global Store

The following are intentionally excluded:

- Redux
- Zustand
- Jotai
- Custom global stores

TanStack Query and React state remain sufficient for V1.

---

### API Communication

All HTTP communication flows through module-owned API clients built on Axios.

Components do not communicate directly with HTTP endpoints.

---

### Forms

Forms use:

- React Hook Form
- Zod

Frontend validation improves user experience while backend validation remains authoritative.

---

# Backend Architecture Summary

### Spring Boot Modular Monolith

The backend is implemented as a single Spring Boot application with clearly separated domain modules.

---

### Module Ownership

Each module owns:

- Domain Logic
- Application Services
- Persistence
- API Endpoints

---

### Layered Architecture

```text
web
 ↓
application
 ↓
domain

infrastructure
 ↑
application
```

Dependencies flow inward.

---

### Module Communication Rule

Modules communicate exclusively through:

```text
module.api
```

Direct access to another module's internal packages is prohibited.

---

### Command and Query Services

Application services are separated into:

- Command Services
- Query Services

Examples:

```text
TaskCommandService
TaskQueryService
```

---

### Transaction Boundaries

Guiding principle:

```text
One Use Case = One Transaction
```

Commands define transactional boundaries.

Queries are read-only transactions.

---

# Persistence Summary

### PostgreSQL

PostgreSQL is the system of record.

---

### Flyway

Database schema changes are managed through Flyway SQL migrations.

Hibernate schema generation is disabled.

---

### Database-Owned Schema

The database owns the schema definition.

Application code must conform to the schema rather than generate it.

---

### Facts Over States

Lifecycle information is represented through timestamps:

```text
completed_at
archived_at
deleted_at
```

rather than workflow state machines.

---

### JSONB Usage

Rich content is stored as JSONB.

Examples:

```text
Task.description
Note.content
```

---

### Ownership Model

Primary resources are directly owned by users.

Examples:

```text
task.user_id
note.user_id
tag.user_id
```

Child entities inherit ownership from their aggregate root.

---

# Security Summary

### Authentication

Authentication uses session-based security.

Current authentication method:

```text
Email + Password
```

---

### Session Storage

Sessions are stored using:

```text
Spring Session JDBC
```

backed by PostgreSQL.

---

### Ownership = Authorization

Access decisions are based entirely on resource ownership.

Users may only access resources they own.

---

### Repository-Level Ownership Filtering

Ownership enforcement occurs within repository queries.

Examples:

```text
findByIdAndUserId(...)
```

This prevents accidental authorization bypasses.

---

### Resource Isolation

Requests for resources that do not exist or are not owned return:

```text
404 Not Found
```

rather than:

```text
403 Forbidden
```

to avoid revealing resource existence.

---

# Key Decisions

| Area | Decision |
|--------|----------|
| Architecture Style | Spring Boot Modular Monolith |
| Frontend Structure | Feature-Oriented Modules |
| Frontend Components | Functional React Components |
| State Management | TanStack Query + React State |
| Global Store | Not Used |
| Database | PostgreSQL |
| Migrations | Flyway |
| Schema Ownership | Database Owns Schema |
| Authentication | Session Authentication |
| Session Storage | Spring Session JDBC |
| Authorization | Ownership = Authorization |
| Module Communication | module.api Only |
| API Style | Resource-Oriented REST |
| Error Format | RFC 9457 Problem Details |
| Search | Case-Insensitive LIKE |
| Lifecycle Modeling | Facts Over States |
| Rich Content | JSONB |
| IDs | Long / BIGINT |

---

# Reading Guide

Recommended onboarding order:

### 1. Architecture Overview

```text
ARCHITECTURE_OVERVIEW.md
```

Provides the architectural map of the system.

---

### 2. Architecture Decision Records

```text
ADR-001 → ADR-008
```

Provides architectural reasoning and accepted standards.

---

### 3. Product Specifications

```text
PRDs
Feature Specifications
```

Provides behavior and business requirements.

---

### 4. Engineering Guidelines

```text
ENG-001 Engineering Guidelines
```

Provides implementation conventions and coding standards.

---

# Future Evolution Paths

Horizon intentionally defines evolutionary paths to avoid premature complexity.

## Search Evolution

```text
LIKE
  ↓
pg_trgm
  ↓
PostgreSQL Full Text Search
  ↓
External Search Engine
```

Migration occurs only when justified by scale or retrieval quality requirements.

---

## Authentication Evolution

```text
Email + Password
  ↓
OAuth Providers
```

Planned providers may include:

- Google
- GitHub

Authentication complexity should be introduced incrementally.

---

## Final Note

Horizon optimizes for:

- Simplicity
- Maintainability
- Clear Ownership
- Low Operational Complexity
- Incremental Evolution

The architecture intentionally favors predictable structure and explicit boundaries over abstraction-heavy or enterprise-oriented designs.