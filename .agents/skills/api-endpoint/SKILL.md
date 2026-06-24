---
name: api-endpoint
description: Use when the user wants to create, modify, design, consolidate, or refactor REST API endpoints, Spring Boot Web controllers, request/response DTO mappings, or URL paths in the backend. Covers controller boundaries, DTO isolation, REST resource organization, input validation, and RFC 9457 error responses.
---

# REST API Endpoint Conventions

This skill governs the standards for implementing RESTful endpoints in the Horizon web controller layers.

## Conventions & Rules

1. **Controller Consolidation Standard:**
   - Controllers represent **REST resources**, not individual use cases.
   - Organize controllers around resource ownership and REST API boundaries. Prefer **one controller per resource** (or closely related resource group), regardless of how many operations that resource exposes.
     - **Preferred**: `AuthController`, `UserController`, `TaskController`, `NoteController`, `TagController`, `SearchController`, `InboxController`
     - **Avoid**: `LoginController`, `RegisterController`, `LogoutController`, `CompleteTaskController`, `ArchiveTaskController`, `CreateTaskController`, `UpdateTaskController`
   - Controllers should: Define REST endpoints, perform request validation, delegate to the appropriate application service, and return HTTP responses.
   - Controllers should **not** represent individual business use cases. Individual use cases belong in the **application layer**, where each use case may have its own command/query service and transaction boundary.

2. **AI Implementation Rule:**
   - Before creating a new controller:
     1. Identify the REST resource the endpoint belongs to.
     2. Check whether an existing controller already owns that resource.
     3. Extend the existing controller whenever possible.
   - A new controller should be created **only if**:
     - it represents a new REST resource or resource group (e.g., `AuthController` vs `UserController`), or
     - the existing controller has become genuinely too large or mixes unrelated resource responsibilities.
   - Do not create a new controller simply because a new endpoint or use case is introduced.

3. **Path Mapping:**
   - Base path: `/api/v1`
   - Resources must use plural naming corresponding to the module (e.g., `/api/v1/tasks`, `/api/v1/notes`, `/api/v1/tags`).

4. **DTO Isolation:**
   - Always map web requests and responses to dedicated DTOs (e.g., `TaskCreateRequest`, `TaskResponse`).
   - Do not expose JPA entities directly.

5. **Lifecycle Actions:**
   - Use explicit POST action endpoints for state transitions rather than generic PATCH modifications:
     - `POST /api/v1/tasks/{id}/complete`
     - `POST /api/v1/tasks/{id}/archive`
     - `POST /api/v1/tasks/{id}/restore`

6. **Error Formats:**
   - Web boundary errors and application business rule failures must be transformed and returned matching **RFC 9457 Problem Details** specifications.
   - Handled via `@RestControllerAdvice` annotations.

7. **Security Isolation:**
   - If an endpoint queries a resource that doesn't exist or is owned by another user, return `404 Not Found` instead of `403 Forbidden` to hide resource existence.

## Step-by-Step Procedure

1. **Create Controller Class:**
   - Annotate with `@RestController` and `@RequestMapping("/api/v1/<plural-resource>")`.
   - Add constructor-injected Command/Query services.

2. **Create Request & Response DTOs:**
   - Define records or classes representing payloads with validation annotations (`@NotNull`, `@Size`, etc.).

3. **Implement Endpoint Methods:**
   - Map URL parameters, headers, and request bodies correctly.
   - Invoke application layer services.
   - Map service output to response DTOs.
