# AGENTS.md — horizon

Full-stack app: **React 19 + Vite (client/)** and **Spring Boot 4.0.6 + Maven (server/)** targeting Java 25.

## Architectural Boundaries

- **Modular Monolith**: Horizon remains a Modular Monolith. Do not introduce microservices, CQRS, or eventing without an ADR.
- **Cross-Module Communication**: Modules must communicate exclusively through `module.api`. Direct access to internal packages (e.g. repositories, domain models, or internal services) of other modules is strictly prohibited.
- **Ownership = Authorization**: Access is granted solely based on resource ownership. Every primary resource is owned by a specific user.
- **Decisions & Escalations**:
  - Consult [HORIZON_DECISION_SUMMARY.md](file:///D:/projects/my-horizon/docs/ai/HORIZON_DECISION_SUMMARY.md) for authoritative product and architectural decisions.
  - Follow the escalation rules in [ENG-001 Engineering Guidelines Section 15](file:///D:/projects/my-horizon/docs/ai/ENG-001%20Engineering%20Guidelines%20v1.0.md#L964) before modifying public APIs, crossing module boundaries, or changing ownership rules.

## Client & Server Agent Guides

For detailed tech stack, conventions, and commands:
- **Client (Frontend)**: Refer to [client/AGENTS.md](file:///D:/projects/my-horizon/client/AGENTS.md)
- **Server (Backend)**: Refer to [server/AGENTS.md](file:///D:/projects/my-horizon/server/AGENTS.md)

## Common Pitfalls & Invariants

### 1. JVM Timezone for PostgreSQL
PostgreSQL 17 may reject JDBC connections from systems with timezones like `Asia/Calcutta` during test execution or CLI commands.
- **REQUIRED SUB-SKILL**: Use `testing-spring-integration` to configure and run Maven/Surefire tests under the UTC timezone.

### 2. React 19 & shadcn/ui v4 Conventions
- **Radix Slot:** Import `Slot` from `"radix-ui"`, but render it as `<Slot.Root {...props} />` (not `<Slot />`).
- **Type Safety on Slots:** To avoid children typing errors, type custom wrappers around slots (e.g., `FormControl`) using standard HTML element props (like `React.ComponentProps<"div">`) instead of referencing the slot type.
- **Type-Only Imports:** Always import TypeScript interfaces/types using `import type` to satisfy the strict `verbatimModuleSyntax` configuration.
- **TanStack Query v5:** Use `isPending` instead of `isLoading` for queries and mutations.
- **App-Bootstrap API Mocking:** APIs called during application initialization or routing bootstrap (e.g., current user check in `beforeLoad` on `/` or root routes) must be mocked in global render tests like `App.test.tsx` (using `vi.mock`) to prevent unhandled network failures and unexpected route redirects.

### 3. Spring Session JDBC & MockMvc Testing
- **REQUIRED SUB-SKILL**: Use `testing-spring-integration` for session invalidation MockMvc assertions and authenticated MockMvc request cookie management.

### 4. UI Aesthetics & Grayscale Contrast (Zinc & Paper)
- **Read DESIGN.md:** Before designing any UI, run `node .agents/skills/impeccable/scripts/context.mjs` to fetch current design principles.
- **Banned Decorative Accents:** Never use decorative glassmorphism (`backdrop-blur-md`), ambient shadows at rest (`shadow-2xl`), uppercase eyebrow kicked headers, or radial background gradients. Surfaces must remain flat-by-default and rely on borders for structure.
- **Standard Inputs:** Use native `<Input />` focus styles without adding custom ring classes.

### 5. Repository Markdown Links (Portability)
When creating or modifying documentation markdown files (e.g. index maps, guides, READMEs) inside the project repository, always use repository-relative links (e.g., `./ARCHITECTURE_OVERVIEW.md#system-architecture`) to avoid breaking links on other machines. Use absolute `file:///` URLs only inside chat responses, implementation plans, walkthroughs, and transient workspace-local artifacts to ensure UI clickability.

### 6. Pre-Planning Context Alignment (Mandatory)
- **REQUIRED SKILL**: Before creating any implementation plan, feature specification, or starting code changes (except pure documentation updates), you MUST use `align-context` to consult the documentation index map at [INDEX.md](file:///D:/projects/my-horizon/docs/ai/INDEX.md). Locate and incorporate all relevant architectural, product, and engineering guidelines directly into your proposed plan or code edits.

### 7. Documentation Index Map Synchronization
- **REQUIRED SKILL**: Whenever any markdown documentation files inside the `docs/ai/` directory are added, renamed, or modified, you MUST run the `sync-docs-index` skill (by running `node .agents/skills/sync-docs-index/scripts/sync-index.mjs`) to regenerate the [INDEX.md](file:///D:/projects/my-horizon/docs/ai/INDEX.md) index map. Do not edit `INDEX.md` manually.

### 8. PowerShell Command Chaining (Windows)
PowerShell does not support `&&` as a command separator (bash-only). On this Windows machine:
- Use `;` to chain commands: `npx tsc -b ; npx vite build`
- Or run each command separately in sequence
- `npm run build` already handles this internally via the npm script runner (which uses sh, not PowerShell), so `npm run build` always works fine

## Startup

- Run `./start.sh` from the repository root on Unix/Git Bash to start PostgreSQL, the backend (port 8081), and the frontend dev server.
- On Windows, run `.\start.ps1` in PowerShell or `start.bat` in Command Prompt to start the entire environment.
- On Windows, use `./mvnw.cmd` for Maven commands.