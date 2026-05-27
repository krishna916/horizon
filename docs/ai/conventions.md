# Coding Conventions

This document dictates how code should be structured, named, tested, and managed in git.

## Project Structure — Backend

Organize by **domain first, then by layer** within each domain:

```
server/src/main/java/com/krishnamurti/horizon/
├── common/                          # Shared utilities, base classes, exceptions
│   ├── exception/                   # Global exception handler, custom exceptions
│   ├── dto/                         # Shared DTOs (e.g., ApiResponse envelope)
│   └── config/                      # Cross-cutting configuration
├── auth/                            # Authentication & authorization
│   ├── controller/
│   ├── service/
│   ├── repository/
│   ├── model/
│   └── dto/
├── user/                            # User management
│   ├── controller/
│   ├── service/
│   ├── repository/
│   ├── model/
│   └── dto/
├── task/                            # Task management / todos
│   ├── controller/
│   ├── service/
│   ├── repository/
│   ├── model/
│   └── dto/
└── [domain]/                        # Future domains follow same structure
    ├── controller/
    ├── service/
    ├── repository/
    ├── model/
    └── dto/
```

## Project Structure — Frontend

```
client/src/
├── components/                      # Shared/reusable UI components
│   ├── Button/
│   │   ├── Button.tsx
│   │   └── Button.module.css
│   └── [ComponentName]/
├── features/                        # Feature/domain modules
│   ├── tasks/
│   │   ├── components/              # Task-specific components
│   │   ├── hooks/                   # Task-specific hooks
│   │   ├── services/               # API calls for tasks
│   │   ├── types/                   # Task-related TypeScript types
│   │   └── pages/                   # Task pages/views
│   └── [domain]/
├── hooks/                           # Shared custom hooks
├── services/                        # Shared API service layer
├── types/                           # Shared TypeScript types
├── utils/                           # Shared utility functions
├── styles/                          # Global styles, CSS custom properties
├── App.tsx
└── main.tsx
```

## Naming Conventions

### Java (Backend)
| Element | Convention | Example |
|---------|-----------|---------|
| Classes | PascalCase | `TaskService`, `UserController` |
| Interfaces | PascalCase (no `I` prefix) | `TaskService` |
| Implementations | PascalCase + `Impl` suffix | `TaskServiceImpl` |
| Methods | camelCase | `getTasksByUserId()` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Packages | lowercase, dot-separated | `com.krishnamurti.horizon.task.service` |
| DTOs | PascalCase + purpose suffix | `CreateTaskRequest`, `TaskResponse` |
| Entities | PascalCase, singular | `Task`, `User`, `Goal` |

### TypeScript / React (Frontend)
| Element | Convention | Example |
|---------|-----------|---------|
| Components | PascalCase file & export | `TodoList.tsx` → `export function TodoList()` |
| Hooks | camelCase with `use` prefix | `useTasks.ts` → `export function useTasks()` |
| Utilities | camelCase | `formatDate.ts` → `export function formatDate()` |
| Types/Interfaces | PascalCase | `Task`, `CreateTaskRequest` |
| CSS Modules | PascalCase matching component | `TodoList.module.css` |
| Constants | UPPER_SNAKE_CASE | `API_BASE_URL` |
| Directories | camelCase | `features/`, `components/` |

### Database
| Element | Convention | Example |
|---------|-----------|---------|
| Tables | snake_case, singular | `task`, `user`, `goal` |
| Columns | snake_case | `created_at`, `user_id`, `is_completed` |
| Foreign keys | `[referenced_table]_id` | `user_id`, `task_id` |
| Indexes | `idx_[table]_[columns]` | `idx_task_user_id` |
| Constraints | `[type]_[table]_[column]` | `uk_user_email`, `fk_task_user` |
| Migration files | `V[number]__[description].sql` | `V1__create_user_table.sql` |

## API Conventions

### URL Structure
```
/api/v1/[resource]              # Collection
/api/v1/[resource]/{id}         # Single resource
/api/v1/[resource]/{id}/[sub]   # Nested resource
```

All endpoints are versioned. Use plural nouns for resources: `/api/v1/tasks`, `/api/v1/goals`.

### Standard Response Envelope
Every API response follows this structure:

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "timestamp": "2026-05-28T00:00:00Z"
}
```

Error responses:
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task with id 123 not found"
  },
  "timestamp": "2026-05-28T00:00:00Z"
}
```

Error codes should be domain-scoped and descriptive: `TASK_NOT_FOUND`, `AUTH_INVALID_TOKEN`, `FINANCE_INVALID_AMOUNT`.

### HTTP Methods
| Method | Purpose | Example |
|--------|---------|---------|
| GET | Read / list | `GET /api/v1/tasks` |
| POST | Create | `POST /api/v1/tasks` |
| PUT | Full update | `PUT /api/v1/tasks/{id}` |
| PATCH | Partial update | `PATCH /api/v1/tasks/{id}` |
| DELETE | Delete | `DELETE /api/v1/tasks/{id}` |

## Error Handling

### Backend
- Use a **global exception handler** (`@ControllerAdvice`) for consistent error responses
- Define custom exceptions per domain when needed: `TaskNotFoundException`, `InvalidFinanceEntryException`
- All exceptions map to the standard error envelope
- Use appropriate HTTP status codes (400, 401, 403, 404, 409, 500)
- Never expose stack traces or internal details in API responses

### Frontend
- Centralized API error handling in the service layer
- User-facing error messages should be clear and actionable
- Log technical details to console in development

## File Size Guideline
- No hard limit, but files exceeding **300 lines** should be reviewed for potential splitting
- Files exceeding **500 lines** are a strong signal to refactor
- Files should **never** exceed **2000 lines**

## Git Conventions

### Branching Strategy
| Branch | Purpose |
|--------|---------|
| `master` | Production state — always deployable |
| `dev` | Active development and testing |
| `feature/<issueId>` | Individual feature work (issueId from project tracker) |
| `fix/<issueId>` | Bug fixes |

### Commit Messages
Follow conventional commits:
```
feat: add task creation endpoint
fix: resolve date parsing error in finance module
refactor: extract common validation logic
docs: update API documentation
test: add integration tests for task service
chore: update Spring Boot version
```

Keep commit messages concise and descriptive. The subject line should complete the sentence: "This commit will..."

---

## Testing Strategy

### Backend Testing Layers

#### 1. Unit Tests
- **What:** Test individual service methods, utilities, and domain logic in isolation
- **How:** JUnit 5 + Mockito for mocking dependencies
- **Where:** `src/test/java/com/krishnamurti/horizon/[domain]/service/`
- **Naming:** `[ClassName]Test.java` (e.g., `TaskServiceImplTest.java`)
- **Run with:** `./mvnw test`

#### 2. Integration Tests
- **What:** Test repository layer and database operations with a real database
- **How:** Spring Boot Test + Testcontainers (PostgreSQL)
- **Where:** `src/test/java/com/krishnamurti/horizon/[domain]/repository/`
- **Naming:** `[ClassName]IntegrationTest.java` (e.g., `TaskRepositoryIntegrationTest.java`)
- **Key point:** Use `@Testcontainers` and `@Container` annotations. Tests run against a real PostgreSQL instance — no H2 substitution.

#### 3. API Tests
- **What:** Test controller endpoints, request/response validation, security rules
- **How:** `@WebMvcTest` + MockMvc for isolated controller testing
- **Where:** `src/test/java/com/krishnamurti/horizon/[domain]/controller/`
- **Naming:** `[ClassName]Test.java` (e.g., `TaskControllerTest.java`)
- **Key point:** Mock the service layer. Test HTTP status codes, response format (envelope), validation errors, and auth rules.

### Frontend Testing Layers

#### 1. Unit Tests
- **What:** Test hooks, utilities, and pure logic functions
- **How:** Vitest
- **Where:** Co-located with source (e.g., `useTasks.test.ts` next to `useTasks.ts`)
- **Naming:** `[filename].test.ts`

#### 2. Component Tests
- **What:** Test component rendering and user interactions
- **How:** Vitest + React Testing Library
- **Where:** Co-located with components (e.g., `TaskList.test.tsx` next to `TaskList.tsx`)
- **Naming:** `[ComponentName].test.tsx`
- **Key point:** Test behavior from the user's perspective — what they see and what happens when they interact. Do not test implementation details.

#### 3. E2E Tests (future)
- **What:** Test complete user flows across the application
- **How:** Playwright (to be added when there are enough flows to justify it)
- **Status:** Not needed yet. Add when task management has a complete CRUD flow in the UI.

### Testing Principles

1. **Test behavior, not implementation** — tests should survive refactoring
2. **Each test should have a clear name describing what it verifies** — `shouldReturnTasksForAuthenticatedUser()` not `testGetTasks()`
3. **No test should depend on another test's state** — each test sets up its own data
4. **Prefer real dependencies over mocks when practical** — use Testcontainers over H2, real components over shallow rendering
5. **Tests are documentation** — reading the test suite should explain what the feature does
