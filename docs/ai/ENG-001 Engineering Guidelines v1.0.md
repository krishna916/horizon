# ENG-001 Engineering Guidelines v1.0

|Field|Value|
|---|---|
|Document ID|ENG-001|
|Document Name|Engineering Guidelines|
|Version|1.0|
|Status|Accepted|
|Owner|Horizon Architecture|
|Created Date|2026-06-14|
|Last Updated|2026-06-14|

---

# 1. Purpose

## Overview

ENG-001 establishes Horizon's engineering standards, implementation conventions, architectural guardrails, and AI-assisted development rules.

This document exists to ensure implementation remains consistent with accepted architecture while preserving developer judgment and flexibility.

ENG-001 is intended to:

- Promote consistency
- Reduce architectural drift
- Improve maintainability
- Support AI-assisted development
- Establish implementation defaults
- Protect accepted architectural decisions

---

## Relationship To ADRs

Architecture Decision Records (ADRs) define:

```
ArchitectureBoundariesTechnology DecisionsSystem Structure
```

Engineering Guidelines define:

```
Implementation StandardsEngineering ConventionsPreferred ApproachesDevelopment Rules
```

---

## Authority Model

When conflicts exist:

```
Product Requirements↓Accepted ADRs↓Engineering Guidelines↓Local Preferences
```

Accepted ADRs always take precedence.

---

# 2. Engineering Philosophy

## Simplicity First

Prefer the simplest solution that satisfies the current requirement.

Complexity must be earned through demonstrated need.

---

## Consistency Over Local Optimization

A slightly imperfect but consistent solution is preferred over a highly optimized but inconsistent solution.

---

## Explicit Over Clever

Prefer:

```
ReadablePredictableObvious
```

over:

```
MagicFramework TricksHidden Behavior
```

---

## Prefer Evolution Over Prediction

Build for today's requirements.

Future requirements earn future architecture.

---

## Favor Boring Technology

Prefer:

```
ProvenDebuggableWell Understood
```

solutions.

---

## Human Understanding Wins

Readability is more important than theoretical elegance.

---

## Prefer Duplication Over Premature Abstraction

Preferred evolution:

```
One Implementation↓Two Similar Implementations↓Observe Pattern↓Create Abstraction
```

Avoid:

```
Predict Similarity↓Create Abstraction
```

---

# 3. Rule Classification

## Required

Rules derived directly from accepted ADRs.

Deviation requires architectural review.

---

## Default

Preferred implementation approach.

Alternative approaches are allowed when justified.

---

## Discouraged

Allowed but require stronger justification.

Should not become the default implementation style.

---

# 4. Architectural Rules

## Required

Accepted ADRs are authoritative architecture.

---

## Required

Horizon remains a Modular Monolith.

---

## Required

Cross-module communication occurs only through:

```
module.api
```

---

## Required

Module boundaries must remain explicit.

---

## Default

Reuse existing structures before introducing new ones.

---

## Discouraged

Architectural creativity without requirements.

---

# 5. Before Adding Something New

Before introducing a new abstraction, module, pattern, framework, or concept ask:

```
Can an existing module own it?Can an existing abstraction solve it?Is it solving a current problem?Does it align with accepted ADRs?Is the added complexity justified?
```

If the answer is unclear:

```
Do Not Add It Yet
```

---

# 6. Module Design Rules

## Module Structure

Every module follows:

```
apiwebapplicationdomaininfrastructure
```

---

## Vertical Ownership

Modules own:

```
ControllersApplication ServicesDomain LogicPersistence LogicModule APIs
```

---

## Public Surface

Only:

```
module.api
```

is public.

---

## Internal Surface

The following are implementation details:

```
webapplicationdomaininfrastructure
```

---

## Shared Kernel

Keep shared code extremely small.

Typical candidates:

```
BaseEntityCurrentUserProviderShared Exceptions
```

---

## Visibility

Prefer:

```
package-private
```

where practical.

---

# 7. Application Layer Rules

## Service Structure

Prefer:

```
CommandServiceQueryService
```

per module.

---

## Commands vs Queries

Commands mutate state.

Queries do not.

---

## Transactions

Transaction boundaries belong in the application layer.

---

## Current User Resolution

Application code accesses identity through:

```
CurrentUserProvider
```

only.

---

## Ownership Enforcement

Repositories enforce ownership.

Application services should not reimplement ownership checks.

---

## Validation Layers

```
Controller↓Application↓Domain
```

---

## Mapping

Prefer explicit mapping.

Avoid reflection-heavy mapping frameworks.

---

## Complexity Rule

Keep logic inside services until pressure exists for extraction.

---

# 8. Domain Layer Rules

## Rich Domain Models

Preferred:

```
task.complete();task.archive();task.restore();
```

---

## Rejected Style

Avoid lifecycle setters such as:

```
task.setStatus(...)
```

---

## Facts Over States

Prefer:

```
completed_atarchived_atdeleted_at
```

Avoid:

```
statusworkflow_state
```

---

## Valid Construction

Constructors should create valid objects.

Avoid invalid intermediate states.

---

## Value Objects

Default to:

```
LongStringInstant
```

Value Objects must earn their existence.

---

## Domain Services

Rare.

Use only when behavior spans aggregates.

---

## Future Domain Protection

Do not create speculative abstractions such as:

```
TaggableEntityArchivableEntityOwnableEntitySearchableEntity
```

without demonstrated pressure.

---

# 9. Persistence Rules

## Query Hierarchy

Preferred order:

```
Repository Method↓Native SQL↓Stored Procedure
```

---

## JPQL

Allowed.

Not preferred.

Use only when clearly simpler.

---

## Native SQL

First-class persistence strategy.

Preferred for:

```
SearchTodayHomeArchiveReportingJSONBAggregations
```

---

## Stored Procedures

Allowed.

Require explicit rationale.

---

## Schema Ownership

Flyway owns schema evolution.

Hibernate validates schema only.

---

## Ownership Queries

Ownership must be enforced at repository level.

---

## Index Philosophy

Indexes support:

```
Observed Retrieval Patterns
```

not speculative future needs.

---

# 10. API Rules

## Style

Use resource-oriented REST.

---

## Resource Naming

Use plural resources.

Examples:

```
/tasks/notes/tags
```

---

## DTO Separation

Use dedicated:

```
Request DTOsResponse DTOs
```

---

## Controllers

Remain thin.

---

## Validation

Controller boundary validation is required.

---

## Error Handling

Centralize through:

```
@RestControllerAdvice
```

---

## Error Format

Use RFC 9457 Problem Details.

---

## Pagination

No pagination in Horizon V1.

---

# 11. Security Rules

## Security Philosophy

Ownership is authorization.

---

## Ownership Enforcement

Repository-level ownership enforcement is mandatory.

---

## Current User Access

Use:

```
CurrentUserProvider
```

only.

---

## Non-Owned Resources

Return:

```
404 Not Found
```

---

## Authentication

Authenticated-by-default.

Public endpoints:

```
POST /auth/registerPOST /auth/login
```

---

## User Module

Owns:

```
RegistrationIdentityAuthentication IntegrationCredential Management
```

---

## Security Complexity

Do not introduce:

```
RolesPermissionsTeamsOrganizationsACLs
```

without a future ADR.

---

# 12. Testing Rules

## Testing Philosophy

Test behavior.

Not implementation.

---

## Default

Prefer fewer high-value tests over many low-value tests.

---

## Test Pyramid

```
Unit Tests↑ manyApplication Service Tests↑ someRepository Integration Tests↑ someAPI Tests↑ fewEnd-To-End Tests↑ very few
```

---

## Domain Tests

### Required

Test rich domain behavior.

Examples:

```
task.complete()task.reopen()task.archive()task.restore()
```

---

### Default

Avoid:

```
SpringDatabasesMocks
```

in domain tests.

---

## Application Service Tests

### Default

Test use-case behavior.

Mock external collaborators.

Examples:

```
CurrentUserProviderCross-Module APIs
```

---

## Repository Tests

### Required

Complex repository queries must be tested.

Examples:

```
TodaySearchInboxArchiveHome
```

---

### Required

Use:

```
PostgreSQL Testcontainers
```

for repository integration tests.

---

### Discouraged

Testing trivial CRUD repository methods.

---

## Controller Tests

### Default

Verify:

```
ValidationStatus CodesRequest Mapping
```

---

## End-To-End Tests

### Allowed

Small suite of high-value workflows.

Examples:

```
AuthenticationCapture → InboxCreate TaskSearch
```

---

## Coverage Philosophy

No mandatory coverage target exists.

Goal:

```
Protect Critical Behavior
```

not maximize metrics.

---

# 13. AI-Assisted Development Rules

## Purpose

AI should accelerate implementation.

AI should not redefine architecture.

---

## ADRs Are Authoritative

If AI output conflicts with an accepted ADR:

```
ADR Wins
```

always.

---

## AI Implements

AI does not architect.

---

## Simplicity Rule

Prefer the simplest solution that satisfies current requirements.

---

## Duplication Rule

Prefer duplication over premature abstraction.

---

## Allowed

```
Two Similar DTOsTwo Similar ServicesTwo Similar QueriesTwo Similar Mappers
```

---

## Discouraged

Creating abstractions because:

```
Something Might Be Reused Later
```

---

## Module Boundaries

AI must respect module boundaries.

Cross-module communication occurs through:

```
module.api
```

only.

---

## Shared Kernel

Shared code must earn its existence.

---

## Framework Usage

Prefer explicit Spring features.

Avoid framework magic.

---

## Persistence Rules

Follow Horizon query hierarchy:

```
Repository Method↓Native SQL↓Stored Procedure
```

---

## API Rules

Generated APIs must follow accepted API conventions.

---

## Testing Rules

AI should prioritize:

```
Business BehaviorDomain RulesComplex Queries
```

---

## Refactoring Rules

Refactor only when a clear benefit exists.

Avoid large-scale restructuring without requirements.

---

## Future-Proofing Rules

Build for today's requirements.

Avoid infrastructure for future concepts.

Examples:

```
GoalsHabitsProjectsTeamsPermissions
```

---

## Escalation Trigger

AI should stop and request guidance when a change would:

```
Cross Module BoundariesChange Public APIsModify Ownership RulesIntroduce New InfrastructureConflict With ADRs
```

---

# 14. When To Break The Rules

## Philosophy

Guidelines are:

```
Strong Defaults
```

not:

```
Immutable Laws
```

---

## Acceptable Reasons

A guideline may be ignored when:

```
The alternative is clearly simplerThe alternative improves clarityThe guideline creates unnecessary complexityReal implementation experience reveals a better approach
```

---

## Unacceptable Reasons

Do not deviate because:

```
It feels more elegantIt is popularA framework recommends itIt may be useful someday
```

---

## Documentation Rule

Significant deviations should document rationale.

---

# 15. ADR Escalation Rules

## Core Principle

Implementation decisions remain local.

Architectural decisions are explicit.

---

## No ADR Required

Examples:

```
New EndpointNew DTONew Repository MethodNew Service LogicNew ValidationNew TestsNew Index
```

when consistent with accepted ADRs.

---

## ADR Review Recommended

Examples:

```
Module Boundary ChangesAPI Convention ChangesPersistence Convention ChangesSecurity ChangesSearch Strategy ChangesLifecycle Modeling Changes
```

---

## New ADR Required

When a decision:

```
Introduces New Architectural PatternsChanges Accepted ADRsChanges Module Communication RulesIntroduces New InfrastructureIntroduces New Security ConceptsChanges Persistence StrategyChanges Deployment Architecture
```

---

## Escalation Questions

Ask:

```
Does this affect multiple modules?Does this create a new architectural dependency?Would future developers need to know this?Would implementation become inconsistent without documenting it?Does this change an accepted ADR?
```

If yes:

```
ADR Review Required
```

---

## Anti-Pattern

Avoid:

```
Architecture By Pull Request
```

where architectural decisions emerge accidentally through implementation.

---

# 16. Related Documents

## Product Foundation

```
PRD-000 Horizon V1 ScopeSPEC-001 Shared ConceptsSPEC-002 Tags
```

---

## Architecture Foundation

```
ADR-002 Domain ModelADR-003 Persistence ArchitectureADR-004 Backend ArchitectureADR-005 API ArchitectureADR-006 Search ArchitectureADR-007 Security & Ownership
```

---

## Authority Model

```
ADRs define architecture.ENG-001 defines implementation guidance.When conflicts exist:ADRs take precedence.
```

---

# 17. Change Log

|Version|Date|Changes|
|---|---|---|
|1.0|2026-06-14|Initial accepted version|