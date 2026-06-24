---
name: cross-module-api
description: Use when implementing, refactoring, or designing inter-module communication, cross-module service dependencies, or module boundaries in the modular monolith. Covers creating or modifying module.api packages, exposing shared services/DTOs, and enforcing Modular Monolith layer coupling rules.
---

# Cross-Module Communication via API Boundaries

In Horizon's Modular Monolith, modules must remain isolated. This skill guides the step-by-step implementation when one module needs to interact with another.

## Strict Boundaries & Rules

1. **API Package Only:**
   - Communication occurs exclusively through the public `module.api` package (e.g., `com.krishnamurti.horizon.task.api`).
   - Direct access to any other package within another module (e.g., `web`, `application`, `domain`, or `infrastructure`) is strictly prohibited.

2. **No Repository Sharing:**
   - Never inject or call repositories belonging to another module. Access target data only through its exposed API service interfaces.

## Step-by-Step Procedure

1. **Expose the Interface in the Target Module:**
   - Locate/create the contract interface inside the target module's `api/` directory (e.g., `TaskQueryApi.java` or `TaskCommandApi.java`).
   - Define the required methods, using primitive values, DTOs, or custom shared records. Avoid exposing JPA entity models directly in the method signatures.

2. **Implement the Contract in the Target Module:**
   - Create the implementation class in the target module's `application/` or `infrastructure/` directory (e.g., `TaskQueryApiImpl.java`).
   - Implement the contract interface, injecting internal repositories or services to fetch the required data.
   - Annotate the implementation with `@Service` or `@Component` so it is managed in the Spring IoC context.

3. **Consume the API in the Client Module:**
   - Inject the interface bean into your client module's service (e.g., in `HomeQueryService.java`).
   - Call the target interface methods as needed.
