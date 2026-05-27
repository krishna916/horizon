# Foundations

This document covers the project's vision, core engineering philosophy, and explicit non-goals.

## Project Vision

### What Horizon Is
Horizon is a **personal management system** — a companion application that grows alongside its creator in life and career.

It is a single place to manage:
- Tasks and todos
- Personal finances (expenses, net worth, portfolio tracking)
- Goals and progress
- Journal entries
- Notes
- Calendar (Google Calendar integration)
- Custom trackers (reading lists, learning topics, wishlists, etc.)
- Analytics dashboards (personal insights across all domains)
- Public pages (blogs, articles, shareable content — long-term)

These domains are **interconnected, not siloed**. A goal might link to tasks. A finance target might be tied to a goal. The system should evolve toward meaningful connections between domains.

### What Horizon Is Not
- **Not a social platform** — no feeds, no followers, no social features
- **Not a team collaboration tool** — no shared workspaces, no team management (a small multi-user workspace is a distant possibility, not a design target)
- **Not mobile-first** — web-first, mobile is a future pipe dream
- **Not an enterprise product** — no multi-tenancy, no B2B features, no admin dashboards
- **Not a clone of any specific product** — it borrows ideas from Notion, Todoist, and others, but follows its own path

### Who Uses It
- **Primary user:** The creator (single user, daily use)
- **Architecture:** Multi-user capable from day one (data is always scoped to a user)
- **Public access:** Eventually, some content (blogs, pages) may be publicly viewable
- **Contributors:** Solo developer now, possibly 2–3 contributors in the far future

### Success Criteria
Horizon is successful when:
- The creator uses it daily as their real personal management system
- It demonstrates meaningful full-stack skills for a portfolio
- It serves as a vehicle for learning TypeScript, deepening Spring Boot knowledge, and exploring AI integration
- It remains maintainable and enjoyable to work on over months/years

---

## Engineering Philosophy

These principles guide every implementation decision. When in doubt, fall back to these.

### 1. Progress Over Perfection
Ship working code first. Refine later. The first iteration of any feature does not need to be perfect — it needs to *work* and be *usable*. Polish comes in subsequent passes.

**What this means in practice:**
- Don't block a feature on "the right abstraction" — use the obvious one
- TODO comments are acceptable for known shortcuts
- Refactoring is a planned activity, not an afterthought guilt

### 2. Simplicity Is a Feature
Every line of code is a maintenance liability. The simplest solution that works is the best solution. Complexity must be *earned* by a concrete problem, not a hypothetical one.

**What this means in practice:**
- No speculative generalization ("what if we need X someday")
- No patterns without a present-day justification
- If you can solve it with a function, don't create a class
- If you can solve it with a class, don't create a framework

### 3. Code Should Reveal Intent
Someone reading the code (including future AI systems) should understand *what* it does and *why* from the code itself. Clear naming, obvious structure, and minimal indirection.

**What this means in practice:**
- Names describe purpose, not implementation (`getUserTasks` not `fetchDataFromDB`)
- Avoid clever code — prefer boring, readable code
- If a pattern needs a comment to explain *why it exists*, consider simplifying the pattern

### 4. Tests Are the Safety Net
This project is built primarily with AI assistance. Tests are the primary mechanism for verifying that AI-generated code actually works and doesn't break existing functionality.

**What this means in practice:**
- AI-generated code must include tests by default
- Tests can be skipped only in exceptional cases (e.g., pure configuration, trivial boilerplate)
- If a feature is hard to test, that's a design smell — simplify the feature
- Tests should verify behavior, not implementation details

### 5. Delete-Friendly Code
Requirements will change. Features will be rewritten. Code should be structured so that deleting or replacing a module doesn't require surgery across the codebase.

**What this means in practice:**
- Keep coupling between domains loose
- Prefer passing data over sharing state
- If removing a feature requires changes in more than 2–3 files outside its own domain, the boundaries need work

### 6. Learn by Building
This project is partly a learning vehicle. It's acceptable to try a new approach, experiment, and occasionally rewrite. The goal is sustainable learning, not theoretical purity.

**What this means in practice:**
- Trying something new (a library, a pattern, an approach) is encouraged
- If an experiment doesn't work out, revert without guilt
- Document what was learned from experiments (even failed ones) in decision records

---

## Constraints & Non-Goals

### Constraints

These are real limitations that shape implementation decisions:

| Constraint | Impact |
|-----------|--------|
| **Free-tier hosting** | Backend (Railway/Render) has cold starts, limited compute, and may sleep after inactivity. Design for graceful handling of slow startups |
| **Solo developer** | Limited time (weekends + 30 min sessions). Features must be scoped to what one person can build, test, and maintain |
| **Burst development** | Code must be easy to pick up after days or weeks away. Clear naming, good comments on complex logic, and up-to-date documentation matter more than usual |
| **Learning investment** | TypeScript is a learning goal. Expect slower frontend development initially. Don't let this pressure oversimplify the TypeScript — learn by doing it properly |
| **No CI/CD yet** | Tests must be runnable locally. Deployment is manual for now. CI/CD can be added when the project has enough tests to justify it |

### Explicit Non-Goals

Things this project will **never** be (or will explicitly **not** pursue now):

| Non-Goal | Reason |
|---------|--------|
| **Social features** | No feeds, followers, likes, or social graphs. This is a personal tool |
| **Team collaboration** | No shared workspaces, team permissions, or multi-user editing. A distant possibility for 2-3 people, not a design target |
| **Mobile-first design** | Web-first. Responsive is nice to have, but native mobile is a pipe dream |
| **Enterprise/B2B** | No multi-tenancy, no organization management, no billing |
| **Real-time collaboration** | No simultaneous editing, no presence indicators |
| **Offline-first** | Internet connection is assumed. Service workers and local-first sync are out of scope |
| **Internationalization (i18n)** | English only. No translation infrastructure |
| **Accessibility (a11y) beyond basics** | Semantic HTML and reasonable keyboard navigation, but no WCAG AA compliance goal for now |
| **Performance optimization** | No premature optimization. Optimize only when something is noticeably slow for one user |
