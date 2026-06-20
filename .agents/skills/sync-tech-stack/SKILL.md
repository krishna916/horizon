---
name: sync-tech-stack
description: Synchronize the tech stack AI documentation with actual project dependencies.
---

# Sync Tech Stack Ledger

This skill automatically synchronizes the project tech stack documentation with the actual package and POM dependencies.

## 🤖 Instructions for AI

When this skill is triggered, perform the following steps:

1. **Read Frontend Dependencies:**
   Read `client/package.json` to identify any newly added or removed frontend libraries, frameworks, or build tools.
   
2. **Read Backend Dependencies:**
   Read `server/pom.xml` to identify any newly added or removed backend libraries (Spring Boot starters, database drivers, utility libraries).
   
3. **Analyze the Current Ledger:**
   Read the existing `docs/ai/tech-stack.md` (or the tech stack sections in architecture docs) to see what is currently documented.

4. **Update the Ledger:**
   Modify the tech stack documentation to reflect the true state of the project:
   - Add new dependencies to their appropriate sections. Provide a brief (1-sentence) explanation of what the library is used for.
   - Remove any libraries that are no longer present.
   - Update version numbers if there have been significant major version bumps.
   - **CRITICAL:** Do not delete or overwrite the "Recommendations for Future Evolution" section or the overall structure.

5. **Report:**
   Summarize exactly what was added, removed, or updated in your chat response.
