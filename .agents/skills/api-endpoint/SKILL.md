---
name: api-endpoint
description: Best practices and conventions for creating resource-oriented REST API endpoints.
---

# REST API Endpoint Conventions

This skill governs the standards for implementing RESTful endpoints in the Horizon web controller layers.

## Conventions & Rules

1. **Path Mapping:**
   - Base path: `/api/v1`
   - Resources must use plural naming corresponding to the module (e.g., `/api/v1/tasks`, `/api/v1/notes`, `/api/v1/tags`).

2. **DTO Isolation:**
   - Always map web requests and responses to dedicated DTOs (e.g., `TaskCreateRequest`, `TaskResponse`).
   - Do not expose JPA entities directly.

3. **Lifecycle Actions:**
   - Use explicit POST action endpoints for state transitions rather than generic PATCH modifications:
     - `POST /api/v1/tasks/{id}/complete`
     - `POST /api/v1/tasks/{id}/archive`
     - `POST /api/v1/tasks/{id}/restore`

4. **Error Formats:**
   - Web boundary errors and application business rule failures must be transformed and returned matching **RFC 9457 Problem Details** specifications.
   - Handled via `@RestControllerAdvice` annotations.

5. **Security Isolation:**
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
