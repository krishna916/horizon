# AI Collaboration Rules

These rules govern how AI systems should behave when working on this codebase. They are designed to prevent common AI failure modes observed in real-world AI-assisted development.

### Rule 1: Reuse Before You Create

Before creating any new component, utility, hook, service method, or helper:

1. **Search the existing codebase** for something that already does what you need
2. **Check shared directories** (`common/`, `components/`, `hooks/`, `utils/`, `services/`)
3. **Check the current domain** for existing patterns
4. If something similar exists, **extend or reuse it** — do not create a parallel version

**Why this rule exists:** AI systems frequently reinvent existing utilities or create duplicate components because they don't check what already exists. This leads to inconsistency, redundant code, and maintenance burden.

### Rule 2: Follow Existing Patterns

When adding to an existing domain or creating a new one:

1. **Find an existing example** of the same type of code (controller, service, component, etc.)
2. **Follow its structure, naming, and conventions exactly**
3. If you believe the existing pattern is wrong, **flag it** — do not silently introduce a different pattern

**Why this rule exists:** Consistency is more valuable than local optimization. A codebase with one mediocre pattern used everywhere is more maintainable than a codebase with five "better" patterns used in different places.

### Rule 3: Don't Assume Beyond the Document

- If a requirement is not stated in this document or by the user, **do not assume it**
- If a decision is marked as "undecided" or "open question", **ask the user**
- If you're unsure whether something is in scope, **ask**
- Never generate code for features that weren't requested

**Why this rule exists:** AI systems tend to "help" by adding features, error handling, or abstractions that weren't asked for. This creates scope creep and introduces untested code paths.

### Rule 4: Always Include Tests

Every implementation should include appropriate tests:
- **Backend:** Unit tests for service logic, integration tests for database operations, API tests for controllers
- **Frontend:** Component tests for UI behavior, unit tests for hooks and utilities
- Tests can be omitted only for: pure configuration files, trivial boilerplate, or when the user explicitly says to skip them

**Why this rule exists:** In an AI-assisted project, tests are the primary proof that generated code actually works. Without them, there's no verification mechanism.

### Rule 5: Explain Non-Obvious Decisions

When generating code, if you make a choice that isn't directly dictated by conventions (e.g., choosing a particular data structure, adding a validation rule, structuring a query), **add a brief comment or explain in your response** why that choice was made.

**Why this rule exists:** The user needs to learn from AI-generated code and make informed decisions about keeping or modifying it. Silent decisions become hidden technical debt.

### Rule 6: Respect the Maturity Level

Always calibrate your solutions to the current project maturity:
- Don't introduce patterns for problems that don't exist yet
- Don't optimize for scale the project hasn't reached
- Don't add abstraction layers "for future flexibility"
- If the simple approach works, use the simple approach

**Why this rule exists:** AI systems are trained on enterprise codebases and tend to default to enterprise patterns. This project is a personal hobby project — solutions should match that reality.

### Rule 7: Maintain Existing Documentation

When making code changes:
- **Preserve all existing comments and docstrings** that are unrelated to your changes
- **Update documentation** that is directly affected by your changes
- **Do not strip comments** to "clean up" code unless explicitly asked

**Why this rule exists:** Comments and documentation represent accumulated context. Removing them loses information that may be expensive to reconstruct.

### Rule 8: Prefer the Approach-First Workflow

Unless the user has indicated comfort with direct implementation:
1. **Explain the approach** you plan to take
2. **Wait for confirmation** before writing code
3. **Highlight trade-offs** and alternatives when relevant

As the user builds familiarity with patterns, they may switch to "just implement it" mode. Respect whichever mode is active.
