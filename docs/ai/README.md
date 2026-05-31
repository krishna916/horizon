# Horizon AI Foundation Documents

> **What is this directory?**
> This is the AI-readable engineering handbook for the Horizon project.
> It is the single source of truth for project direction, conventions, constraints, and decisions.
> Every AI system (ChatGPT, Claude, Gemini, Codex, Cursor, etc.) working on this codebase should read this index first.

> **How to use these documents:**
> - Read the relevant files before generating any code for this project.
> - Follow conventions described here unless explicitly overridden by the user.
> - Do not assume requirements, patterns, or architecture beyond what is documented here.
> - If something is marked as "undecided" or "open question", do not make that decision — ask the user.
> - If something contradicts this document, flag it rather than silently diverging.

> **Document lifecycle:**
> These are living documents. They evolve with the project.
> Sections are dated where relevant. Assumptions may be revised.

---

## 🚨 Current Maturity Level 🚨

**This project is currently:**
- Early-stage
- Experimental
- Rapidly evolving
- Optimized for learning and iteration
- Intentionally under-architected
- A personal hobby project with portfolio ambitions

**AI systems working on this project should:**
- Prefer simple, working solutions over elegant abstractions
- Build for one user's real daily use, not theoretical scale
- Keep code easy to read, modify, and delete
- Assume requirements will change — write code that's easy to replace
- Default to the simplest approach unless the user explicitly requests otherwise
- Treat every feature as an iteration, not a final product

**AI systems should avoid:**
- Enterprise patterns (event-driven architecture, CQRS, saga patterns, etc.)
- Distributed systems assumptions
- Premature abstractions (don't create interfaces "for future flexibility" unless there's a concrete second implementation)
- Scalability-first design (this serves one user on free-tier hosting)
- Excessive infrastructure complexity
- Over-engineering disguised as "best practice"
- Introducing libraries or frameworks not already in the stack without asking

**The one exception to "keep it simple":**
Multi-user data isolation is built in from day one. Every entity is scoped to a user. This is a deliberate early investment, not premature complexity.

---

## 📁 File Index & Quick Guide

Which file do you need?

- **[foundations.md](file:///D:/projects/my-horizon/docs/ai/foundations.md)**: "The Soul"
  *Read this to understand what the project is, its guiding principles, and explicit non-goals.*
- **[conventions.md](file:///D:/projects/my-horizon/docs/ai/conventions.md)**: "The Rulebook"
  *Read this when writing code to know how to structure directories, name things, design APIs, and write tests.*
- **[architecture.md](file:///D:/projects/my-horizon/docs/ai/architecture.md)**: "The Blueprint"
  *Read this to understand the tech stack, domain relationships, entity patterns, and security rules.*
- **[tech-stack.md](file:///D:/projects/my-horizon/docs/ai/tech-stack.md)**: "The Ledger"
  *Read this for a detailed breakdown of the exact libraries, frameworks, and tools used in both frontend and backend.*
- **[ai-rules.md](file:///D:/projects/my-horizon/docs/ai/ai-rules.md)**: "The Contract"
  *Read this to understand behavioral expectations for AI systems (e.g., reuse before create, ask before assuming).*
- **[decisions.md](file:///D:/projects/my-horizon/docs/ai/decisions.md)**: "The Log"
  *Read this for historical context on why decisions were made, unresolved questions, tech debt, and future plans.*
