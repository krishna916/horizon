# Proposed authoritative amendment — PRD-009 Navigation v1.0

**Status:** WORDING APPROVED on 2026-11-22. Authoritative Navigation edits are staged in [knowledge-store draft PR #1](https://github.com/krishna916/horizon-knowledge-store/pull/1), **merged to `main`** (commit [`631e2a8`](https://github.com/krishna916/horizon-knowledge-store/commit/631e2a81e00f8816d983fdca3b289a903f2cc3b3)). This file does not replace the authoritative PRD.

**Source inspected:** `PRD-009 Navigation.md`, project-provided Draft v1.0; SHA-256 `721043c4c2124347e0464da066931437a18c5505a0776214f9b92b5bf1a080ef`. Read the current knowledge-repository revision before applying.

**Approved basis:** [issue #68 Notes direct-page UX](https://github.com/krishna916/horizon/issues/68), [approved Notes design baseline](../../../design/notes-workspace/DESIGN-SPEC.md), [#75 architecture](https://github.com/krishna916/horizon/issues/75). The purpose is a **single, clear Notes-specific exception** without changing Tasks, global Search, Inbox, Archive/Trash routes, browser semantics, or navigation taxonomy.

## A. `6 FR-008 Object Navigation Pattern` — replace requirement/rationale

**Current requirement:** “Tasks and Notes shall follow” `List → Side Panel → Full Page`.

**Proposed replacement:**

> **Tasks** follow **List → Side Panel → Full Page**. A Task's side panel provides contextual inspection; its full page remains a canonical navigable destination.
>
> **Notes** follow **Cards/List → Full Page** directly. Selecting an existing Note from either browsing mode or starting New Note opens the full-page Notes editor without an intermediate Note side panel or Note preview overlay. This is a deliberately approved Notes-specific interaction exception, not a redesign of Task navigation.
>
> All persisted objects remain deep-linkable at their canonical routes; preserve return-to-origin behavior and browser history.

**Proposed rationale:** Task triage benefits from contextual inspection; Notes benefit from a document-first writing surface. Consistency means predictable routing/return behavior, **not forcing identical navigation surfaces**.

## B. `6 FR-009 Side Panel Behavior` — scope to applicable workspaces

Keep the existing behavior and examples for Tasks opened from Search/Inbox/Today, and general contextual panels **where they exist**. Add at the beginning:

> The side-panel requirements apply when a workspace **uses a side panel**. In V1, **Tasks** use this contextual-inspection pattern; **Notes do not require or use a Note side panel**. Do not create a Notes side panel merely to satisfy this generic requirement.

Do not weaken the rule that an open Task panel preserves its origin.

## C. `6 FR-010 Full Page Behavior` / `FR-011 Canonical Routes` — append Notes explicitness

Keep canonical navigation and routes. Add:

> Selecting a Note, New Note, or a Note result in Search/Inbox navigates directly to its full-page editor. Persisted Notes use `/notes/{id}`. New unpersisted drafts may use `/notes/new`; upon first meaningful Note persistence replace the ephemeral route with `/notes/{id}` without adding a duplicate Back entry. Refresh/direct links to persisted Notes must resolve normally.

Do not change `/tasks/{id}`, `/notes`, `/inbox`, Search, or Settings/Trash canonical routes.

## D. `7 UX Requirements → UX Constraints` — replace one overly broad statement

Replace:

> Tasks and Notes should behave consistently.

With:

> Tasks and Notes share consistent navigation **principles**: identifiable canonical routes, browser history, origin/context preservation, clear back/close behavior and authorization. Their **interaction surfaces differ intentionally**: Tasks use contextual side-panel inspection; Notes open full-page directly.

Keep every other UX constraint, including “Side panels are not navigation” and “Full pages do not introduce different capabilities,” when applied to workspaces that have those surfaces.

## E. `8 Information Architecture → Workspace Navigation` — replace shared diagram

Current one-size diagram is `Workspace → List → Side Panel → Full Page`.

**Proposed replacement:**

```text
Tasks Workspace → Task List → Side Panel → Full Page
Notes Workspace → Cards or List → Full-page Note Editor
```

Notes has separate Active/Archived collection controls (see PRD-005) and the per-browser Cards/List preference. That is **Notes behavior**, not a change to the global nav taxonomy/sidebar.

Keep `Search Navigation → Results → Full Page` and `Lifecycle Navigation` unchanged. A **file preview modal** opened inside a Note editor is for the selected file only; it does not reintroduce a Notes panel or modify routes.

## F. `10 States & Behaviors → Workspace Navigation` — split the transition

Replace:

```text
Workspace → Side Panel → Full Page
```

With:

```text
Task Workspace → Task Side Panel → Task Full Page
Notes Workspace (Cards/List) → Note Full Page
```

The existing “Side Panel State” definition remains valid for Tasks. Notes use “Full Page State” directly. Do not change Search or Settings transitions.

## G. `12 Navigation → Navigation Rules` — add the Notes exception

Retain all existing universal rules and append:

> - From Notes Cards or List, opening a Note navigates directly to `/notes/{id}` (full-page editor), not to a Note side panel.
> - New Note starts at `/notes/new` as an unpersisted draft. Its first meaningful title/body/image/attachment change may persist the Note, updating the route to `/notes/{id}` without a duplicate history entry. A tag-only draft does **not** persist a Note.
> - Returning to Notes restores the source collection, Cards/List selection, filter/sort and scroll as practical. Direct links, refresh and Browser Back remain reliable.
> - Search and Inbox entries pointing to a Note open the canonical full-page editor, preserving origin where possible. Tasks continue to use their existing context-preserving side panels.

No routing or behavior changes for tasks, other global experiences, or administrative areas.

## H. `13 Edge Cases` — supplement only Notes opening/return

Existing Task Search → Back/Search, Inbox side panel, deleted-object/Trash, archived-object and refresh scenarios remain in place.

Append an explicit Note scenario:

> **Scenario:** User is browsing the Archived Notes List, opens a Note, and returns.  
> **Expected:** The Note opens in the full-page editor. Returning restores the Archived collection, List mode and reasonable prior scroll/filter/sort context. No Note side panel is opened.
>
> **Scenario:** User opens `/notes/new`, only selects tags, then leaves.  
> **Expected:** No persisted Note and no extra navigation-history entry. On first meaningful creation, route replacement leads to canonical `/notes/{id}`.

Do not change Global Trash's read-only behavior or its previous-lifecycle restore rule.

## I. Governance and audit

After explicit approval, apply these **section-scoped** edits to the authoritative PRD-009 and update its Version/Last Updated/Change Log. No new navigation framework, drawer library or cross-workspace UI convention is implied. Keep general PRD-009 ownership and its taxonomy unchanged.

**Mirror follow-up:** `docs/ai/HORIZON_PRODUCT_CONTEXT.md` in the application repository still needs an independent review after authoritative docs are amended; this proposal does **not** silently edit it.
