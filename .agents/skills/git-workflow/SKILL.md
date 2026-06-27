---
name: git-workflow
description: Use when starting any feature, fix, refactor, or implementation task in the Horizon repository — before writing or modifying any code. Also applies when committing, merging, branching, or tagging. Ensures the agent is on the correct branch before touching anything.
---

# Git Workflow — Horizon

> [!IMPORTANT]
> **Stop. Check your branch before touching any file.**
> Run `git branch --show-current`. If you are on `main` and this is not a direct-to-main change (see below), create a `feature/*` branch now before proceeding.

## Step 0 — Branch Check (mandatory, every task)

```bash
git branch --show-current   # see where you are
```

| Situation | Action |
|---|---|
| On `main`, feature/fix work | `git checkout -b feature/<short-name>` first |
| On `main`, docs/tiny fix | OK to stay on `main` |
| Already on correct `feature/*` | Proceed |

**Never start writing code on `main` for feature or fix work.**

---


| Branch type | Pattern | Example |
|---|---|---|
| Long-lived | `main` | — |
| Feature work | `feature/*` | `feature/user-registration`, `feature/task-create` |

**`main` is the only permanent branch.** All feature branches are short-lived.

## Commit Messages

Write in plain English, intent-driven, imperative style. If a Jira ticket ID is available (e.g., in the task context or branch name), start the commit message with it:

```
✅ CORE-9: Add user registration
✅ CORE-12: Implement task creation
✅ CORE-45: Fix null pointer in TaskService
✅ Add user registration (if no Jira ticket ID is available)

❌ WIP
❌ More Changes
❌ Fix Stuff
❌ asdfg
```

**Rule:** A commit message completes the sentence: _"This commit will…"_ (following the ticket ID prefix).

## Merges

- **Small and frequent** — one thin slice of work ≈ one merge.
- No long-lived feature branches. If a branch lives more than a few days, it is too large — slice it.

## Releases

- `main` = latest working version at all times.
- **No release branches.** Use milestone tags instead:

```
v0.1.0-m0   ← Milestone 0
v0.2.0-m1   ← Milestone 1
```

Tag format: `v<major>.<minor>.<patch>-m<milestone>`

## Direct-to-Main

Allowed **only** for:
- Documentation updates
- Minor refactors (no behaviour change)
- Small bug fixes (< ~10 lines)
- Build config changes (e.g. `.gitignore`, `pom.xml` version bump)

All other work goes through a `feature/*` branch.

## Quick Reference

| Situation | Action |
|---|---|
| New feature / story | `git checkout -b feature/<name>` |
| Ready to integrate | Merge into `main`; delete feature branch |
| Milestone reached | `git tag v<x>.<y>.<z>-m<n>` |
| Docs / tiny fix | Commit directly to `main` |
| Tempted to keep long branch | Slice — merge what's done, continue in new branch |
