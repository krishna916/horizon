# Architecture

This document covers the technology stack, domain design, entity structures, and security posture.

## Tech Stack Decisions

### Committed Stack (do not change without explicit user decision)

| Layer | Technology | Reason |
|-------|-----------|--------|
| **Backend Runtime** | Java 25 | Creator's primary language, professional background |
| **Backend Framework** | Spring Boot 4.x | Comfortable territory, industry-relevant, portfolio value |
| **Database** | PostgreSQL (Supabase) | Managed, generous free tier, potential for real-time features later |
| **Frontend Framework** | React 19 | Creator's JS/React background |
| **Frontend Language** | TypeScript | Learning goal — creator wants to build TS proficiency |
| **Build Tool (Frontend)** | Vite | Fast, modern, already configured with React Compiler |
| **Build Tool (Backend)** | Maven | Standard for Spring Boot, already configured |
| **ORM** | Spring Data JPA / Hibernate | Standard Spring ecosystem choice |
| **Migrations** | Flyway | Already integrated, SQL-based migrations |

### Deployment Targets

| Component | Platform | Notes |
|-----------|----------|-------|
| **Frontend** | Vercel or GitHub Pages | Static hosting, free tier |
| **Backend** | Railway or Render | Container hosting, free tier |
| **Database** | Supabase | Managed PostgreSQL, free tier |

> **Important:** Keep backend and database in the same region to minimize latency. This matters because they're on separate platforms.

### Authentication Strategy
- **Phase 1 (now):** JWT-based authentication
- **Phase 2 (short-term):** Add OAuth2 with Google
- **Future:** Other OAuth providers as needed

### Technologies Explicitly Not Needed Yet
These should **not** be introduced unless the user explicitly requests them:
- Redis or any caching layer
- Message queues (RabbitMQ, Kafka, etc.)
- WebSockets / real-time infrastructure
- GraphQL
- Microservices or service decomposition
- Docker/Kubernetes for deployment (platforms handle this)

### Open Decisions (not yet resolved)
- **CSS framework:** TailwindCSS, vanilla CSS, or another option — undecided. AI should ask before choosing a CSS approach for new work.
- **Component library:** Whether to adopt a component library (e.g., Radix, shadcn/ui, Mantine, etc.) — undecided. AI should not assume vanilla components are the default.

> These decisions should be made before serious UI work begins. Explore options that align with modern industry trends and developer productivity.

### Technologies on the Horizon (future interest, not planned)
- AI/LLM integration (approach undecided — will need data guardrails)
- Mobile application (distant future, approach undecided)
- Background/async job processing (needed eventually, solution undecided)
- Real-time features (Supabase has capabilities here if needed)

---

## Domain Concepts

This section maps the known domains, their current status, and how they relate. It helps AI systems understand what exists, what's planned, and what's vague.

### Domain Map

| Domain | Status | Priority | Notes |
|--------|--------|----------|-------|
| **Task Management** | 🔜 First to build | High | Todos, task tracking, statuses, priorities |
| **Finance** | 📋 Planned | Medium | Expense tracking, net worth, portfolio tracking. No sensitive credentials — aggregated data only |
| **Goals** | 📋 Planned | Medium | Define and track goals. Framework undecided (SMART? OKR? Custom?) — **open question** |
| **Journal** | 📋 Planned | Medium | Personal journal entries |
| **Notes** | 📋 Planned | Medium | General note-taking |
| **Calendar** | 📋 Planned | Low | Google Calendar integration |
| **Custom Trackers** | 💭 Idea | Low | User-defined trackers (reading list, learning topics, wishlist, vacation spots). Implies flexible/generic data model |
| **Analytics** | 💭 Idea | Low | Per-user dashboards with insights across domains. Vague — needs design when domains mature |
| **Public Pages** | 💭 Idea | Low | Blogs, articles, shareable content (Notion-like). May need rich editor (Konva.js or alternatives). Long-term |
| **Auth & User** | 🔜 First to build | High | User registration, login, profile. Foundation for everything else |

**Status legend:**
- 🔜 = Next to implement
- 📋 = Planned with reasonable clarity
- 💭 = Idea stage — vague, may change significantly

### Domain Relationships

Domains are **interconnected, not siloed**. Known relationships:

```
Auth & User ──── owns everything (every entity has a user_id)
     │
     ├── Task Management
     │        │
     │        └──── Goals (a goal can have linked tasks)
     │                │
     │                └──── Finance (a financial target can be a goal)
     │
     ├── Journal ──── Notes (may share editor/content model)
     │
     ├── Custom Trackers (generic, can link to any domain)
     │
     └── Analytics (reads from all domains, writes to none)
```

> **Important for AI:** These relationships are directional guidance, not a rigid schema. Do not pre-build cross-domain linking infrastructure. Build each domain independently first. Add connections only when a concrete feature requires them.

### Common Entity Patterns

Every domain entity should follow these baseline patterns:

```java
// Every entity has:
// - A generated primary key (UUID or Long — undecided, see Open Questions)
// - A user_id foreign key (multi-user isolation)
// - created_at and updated_at timestamps
// - Soft delete via is_deleted flag (preferred over hard deletes)
```

> **Open question:** UUID vs Long for primary keys. UUID is better for distributed systems and URL safety. Long is simpler and more performant for a single-database monolith. Decision should be made before the first entity is created.

---

## Security & Privacy Philosophy

### Data Sensitivity Classification

| Category | Sensitivity | Example Data | Handling |
|----------|------------|-------------|----------|
| **Account** | Standard | Email, hashed password, profile | Standard encryption, secure auth |
| **Financial** | Moderate | Monthly expenses, net worth, portfolio values | No bank credentials or account numbers. Aggregated/manually entered data only |
| **Personal** | Low-Moderate | Journal entries, goals, tasks | Personal but not catastrophic if exposed |
| **Public** | None | Blog posts, shared pages | Intentionally public |

### Security Principles

1. **HTTPS everywhere** — all communication between frontend, backend, and database must be encrypted in transit (TLS). Deployment platforms (Vercel, Railway, Supabase) handle this by default.

2. **Encryption at rest** — database encryption at rest via Supabase's built-in capabilities. This is primarily a learning exercise and an extra security layer, not a response to a specific threat.

3. **Authentication is non-negotiable** — every API endpoint (except public pages and auth endpoints) requires a valid JWT. Spring Security should deny by default, allow by exception.

4. **User data isolation** — every database query must be scoped to the authenticated user's `user_id`. There is no admin role that can view other users' data (for now). A missing `user_id` filter is a **critical bug**.

5. **No secrets in the frontend** — API keys, database credentials, and JWT secrets must never appear in client-side code. Use environment variables on the backend.

6. **Passwords** — bcrypt hashing, minimum length enforcement. Standard Spring Security defaults are sufficient.

### AI Data Guardrails (for future LLM integration)

When AI/LLM features are added:
- **Default to not sending** — personal data should not be sent to external AI APIs unless the feature explicitly requires it
- **Categorize data** — define which data categories (financial, journal, tasks) can be sent externally and which cannot
- **User consent** — the user should be able to control what data is shared with AI services
- **Anonymization** — when possible, strip identifying details before sending data to external APIs

> **Status:** These guardrails are future guidance. No AI integration exists yet. Specific implementation decisions will be made when the first AI feature is designed.
