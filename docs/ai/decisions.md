# Decisions & Future Considerations

This document holds architectural decision records (ADRs), technical debt, open questions, and anticipated future architecture changes.

## Decision Records

Significant technical decisions are recorded here in a lightweight ADR format. This creates a trail of *why* things are the way they are.

### ADR Format

```
### ADR-[number]: [Title]
- **Date:** YYYY-MM-DD
- **Status:** Proposed | Accepted | Superseded | Deprecated
- **Context:** What situation prompted this decision?
- **Decision:** What was decided?
- **Rationale:** Why this option over alternatives?
- **Consequences:** What follows from this decision?
```

---

### ADR-001: Multi-User Architecture From Day One
- **Date:** 2026-05-28
- **Status:** Accepted
- **Context:** The project is currently single-user but may need multi-user support in the future. Retrofitting user isolation into an existing data model is extremely painful.
- **Decision:** Every database entity will have a `user_id` foreign key. Every query will be scoped to the authenticated user.
- **Rationale:** The cost of adding `user_id` from the start is minimal (one column, one filter). The cost of adding it later is a full database migration and service layer rewrite.
- **Consequences:** Slightly more boilerplate per entity. All repository queries need user scoping. But the data model is future-proof for multi-user.

---

### ADR-002: Domain-First Package Structure
- **Date:** 2026-05-28
- **Status:** Accepted
- **Context:** Spring Boot projects typically organize by layer (`controllers/`, `services/`, `repositories/`) or by domain (`task/`, `finance/`, `goals/`).
- **Decision:** Organize by domain first, then by layer within each domain.
- **Rationale:** Domain-first makes it easy to understand and modify a single feature without navigating across many top-level directories. It also makes delete-friendly code easier — removing a domain is removing one directory.
- **Consequences:** Cross-domain shared code goes in `common/`. Some duplication of layer structure across domains, which is acceptable.

---

### ADR-003: PostgreSQL with Supabase (No H2 for Testing)
- **Date:** 2026-05-28
- **Status:** Accepted
- **Context:** Integration tests need a database. H2 is a common in-memory substitute but doesn't support all PostgreSQL features and can hide bugs.
- **Decision:** Use Testcontainers with a real PostgreSQL image for all integration tests. No H2 dependency.
- **Rationale:** Tests should run against the same database engine as production. Testcontainers is already in the project dependencies.
- **Consequences:** Tests require Docker to be running. Slightly slower test startup. But test results are trustworthy.

---

### ADR-004: JWT Authentication (Phase 1)
- **Date:** 2026-05-28
- **Status:** Accepted
- **Context:** The application needs authentication. Options considered: session-based, JWT, OAuth-only.
- **Decision:** Start with JWT-based authentication. Add Google OAuth as Phase 2.
- **Rationale:** JWT is stateless and works well with a separated frontend/backend deployment. It's simpler to implement initially than full OAuth. Google OAuth will be added as a second auth method, not a replacement.
- **Consequences:** Need to handle token refresh, token storage on the frontend (httpOnly cookies preferred over localStorage), and token validation on every request.

---

### ADR-005: Conventional Commits
- **Date:** 2026-05-28
- **Status:** Accepted
- **Context:** Commit message consistency is important for readability, changelog generation, and AI parsing.
- **Decision:** Use conventional commit format (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).
- **Rationale:** It's a widely adopted standard, easy to follow, and enables automated tooling in the future (changelog generation, semantic versioning).
- **Consequences:** Requires discipline in commit messages. AI systems should follow this format when suggesting commits.

---

---

### ADR-006: Frontend UI Stack — TailwindCSS v4 + shadcn/ui
- **Date:** 2026-05-31
- **Status:** Accepted
- **Context:** Serious UI work is beginning. The CSS framework and component library decisions were explicitly flagged as open in ADR design documents. A modern, scalable, and productive stack was needed.
- **Decision:** Adopt TailwindCSS v4 (via `@tailwindcss/vite`), shadcn/ui (Radix Vega preset), Radix UI primitives, Lucide React icons, and the clsx + tailwind-merge + CVA utility trio.
- **Rationale:**
  - TailwindCSS v4 integrates natively with Vite via the official `@tailwindcss/vite` plugin — no separate config file needed.
  - shadcn/ui provides copy-owned, accessible, unstyled-first components. No vendor lock-in; components live in `src/components/ui/`.
  - Radix UI ensures accessibility out of the box (keyboard navigation, ARIA attributes).
  - Lucide React is the default icon library in the Vega preset and has a consistent, clean aesthetic.
  - `cn()` utility (clsx + tailwind-merge) is the standard shadcn pattern for conditional class composition.
  - CVA (class-variance-authority) enables structured, type-safe component variant management.
- **Consequences:**
  - All UI components go through the `components/ui/` layer first, then `components/shared/` for Horizon-specific wrappers.
  - Tailwind classes are the primary styling mechanism — no global CSS unless strictly necessary.
  - Component variants must be defined using CVA, not ad-hoc conditional strings.
  - See `docs/architecture/adr/ADR-002-frontend-ui-foundation.md` for component ownership rules.

---

*New ADRs should be appended here as decisions are made. Number them sequentially.*

---

## Future Evolution Considerations

This section captures how the project might evolve. These are **not commitments** — they are directional thoughts to help AI systems avoid building in ways that would conflict with likely future directions.

### Near-Term (next few months)
- **Task management v1** — full CRUD, basic statuses, priorities, due dates
- **Auth system** — JWT login/register, then Google OAuth
- ~~**CSS/component framework decision**~~ — ✅ Resolved (ADR-006: TailwindCSS v4 + shadcn/ui)
- **Frontend routing** — React Router or TanStack Router — decide before first multi-page UI work
- **CI/CD pipeline** — GitHub Actions for running tests on PR, basic deployment automation
- **Project tracker** — choose a tool for issue tracking (GitHub Issues, Linear, etc.)

### Medium-Term (3–6 months)
- **Finance module** — expense tracking, net worth snapshots
- **Goals module** — define goals, link to tasks
- **Journal** — basic text entries with dates
- **Frontend data fetching pattern** — evaluate React Query / TanStack Query vs. custom hooks
- **API documentation** — SpringDoc/OpenAPI is already a dependency, configure Swagger UI

### Long-Term (6+ months, highly speculative)
- **Analytics dashboards** — per-domain insights
- **Custom trackers** — flexible data model for user-defined tracking
- **Public pages** — shareable content, rich editor
- **AI/LLM integration** — with data guardrails
- **Background job processing** — for async operations
- **Mobile app** — approach TBD (React Native? PWA? Native?)

### Architecture Evolution Signals

The current monolith is appropriate. Here are signals that would justify increased architectural complexity:

| Signal | Possible Response |
|--------|------------------|
| API response times consistently > 500ms | Investigate query optimization, add database indexes |
| Frontend bundle size > 1MB | Code splitting, lazy loading routes |
| Background tasks blocking API responses | Add async job processing (Spring's `@Async`, or a lightweight job queue) |
| Multiple contributors working simultaneously | Stricter branching rules, CI/CD, code review process |
| Deployment downtime during updates | Blue-green deployment or rolling updates via platform features |
| Need for real-time updates | Evaluate SSE (Server-Sent Events) before WebSockets — simpler and sufficient for most cases |

> **Key principle:** Don't build for these signals until they actually occur. This table exists so AI doesn't solve these problems prematurely, but also doesn't build in ways that make solving them harder later.

---

## Technical Debt & Open Questions

### Open Questions (decisions needed before or during implementation)

| Question | Context | Impact | When to Decide |
|----------|---------|--------|----------------|
| **UUID vs Long for primary keys?** | UUID is URL-safe and distributed-friendly. Long is simpler and faster for a single DB | Affects every entity, every migration, every API URL | Before first entity is created |
| **Goals framework?** | SMART, OKR, custom, or unstructured? | Affects the goals data model and UI | Before goals module is designed |
| **Frontend routing library?** | React Router is the standard, but alternatives exist | Affects navigation architecture | Before first multi-page UI work |
| **Frontend state management?** | React context, Zustand, Jotai, Redux? Or just component state + URL params? | Affects how data flows through the frontend | Before frontend grows beyond a few components |
| **Frontend data fetching?** | Raw fetch + custom hooks vs. TanStack Query vs. SWR? | Affects caching, loading states, error handling patterns | Before second API integration |
| ~~**CSS/component framework?**~~ | ✅ Resolved: TailwindCSS v4 + shadcn/ui (ADR-006) | — | Done |
| **Project tracker?** | GitHub Issues, Linear, Jira, or something else? | Affects branch naming (feature/<issueId>) | Before structured development begins |
| **Soft delete strategy?** | `is_deleted` boolean vs. `deleted_at` timestamp vs. separate archive table | Affects query patterns and data recovery | Before first entity with delete support |

### Known Technical Debt

*None yet — the project is just starting. This section will track shortcuts taken for speed that should be revisited later.*

Format for future entries:
```
| Debt Item | Location | Why It Was Taken | Remediation Plan | Priority |
|-----------|----------|-----------------|-----------------|----------|
| Example: hardcoded admin email | AuthService.java | Quick MVP auth | Replace with config property | Medium |
```
