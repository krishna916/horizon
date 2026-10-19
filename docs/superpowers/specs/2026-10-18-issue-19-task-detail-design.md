# Issue #19 — Task Detail Panel, Split Layout, and Canonical Page — Design

**Date:** 2026-10-18  
**Status:** Written specification approved by owner on 2026-10-18; implementation plan follows  
**Owner:** Horizon  
**Implementer:** Luna (after implementation-plan approval)  
**Issue:** https://github.com/krishna916/horizon/issues/19

## 1. Intent and authoritative references

Provide one consistent, read-only task-detail experience that users can open alongside the Tasks list or at the canonical `/tasks/{id}` URL. Preserve a predictable browser history and the user's Tasks context while making the layout resizable, accessible, and safe for invalid or unauthorized IDs.

Read together with:
- `HORIZON_CONSTITUTION.md` — object navigation, canonical routes, origin restoration, feature ownership, security and query conventions.
- `PRD-004 Tasks` — FR-024 and Task Detail information architecture; no description preview in task rows.
- `docs/design/tasks-workspace/DESIGN-SPEC.md` and its approved screenshots — initial visual baseline; mockup JavaScript/hash routing is **not** implementation authority.
- `ENG-002 Frontend Engineering Guide` — feature-owned code, local UI state, TanStack Query server state.
- GitHub issues #18 (create), #20 (field editing), #23 (lifecycle controls), #24 (rich text), and their relevant later section-owning stories.

The executable repository is authoritative for existing code conventions. This document resolves issue #19's previously deferred interactions; it does **not** authorize the other stories' functionality.

## 2. Scope and exclusions

**Deliver in #19**
- Clicking task title/row or readable key opens the selected detail in a side panel inside Tasks.
- One reusable detail display for panel and dedicated page; accessible loading, unavailable and retry states.
- Shared panel shell extensible to create mode for issue #18, without building the create form here.
- 60/40 initial split, bounded pointer/keyboard resizing, per-visit width memory, modal overlay fallback.
- Canonical `/tasks/{id}` full page with approved single-column width and context-sensitive Back to Tasks.
- URL-backed panel selection, coherent history, direct-link and reload behavior, own-user isolation.
- Frontend tests and browser scenarios below.

**Do not deliver in #19**
- Creation form or task creation (#18); editing/dirty drafts (#20); completion/checklist changes; lifecycle mutations or working menus (#23); rich-text editing/rendering (#24); tags, attachments or activity UI without production backing; mobile-specific designs.
- New task API, backend migration, global navigation framework, global state store or extra frontend package unless existing primitives demonstrably cannot meet the contract.
- Dummy actions, mock data, false empty sections, copied mockup event handlers, or hash URLs.

## 3. UX surfaces and layout

### Tasks list plus panel

Reuse the existing authenticated AppShell, global sidebar, header, theme, and live Tasks list. Existing list-only centered layout remains visually coherent; on selection, the Tasks workspace uses the **actual available content width after the sidebar**, not its current `max-w-5xl` column width, to calculate the split.

The initial list/detail allocation is **60%/40%** including a 5px divider adjustment. Enforce **list minimum 480px**, **detail minimum 360px**, and **divider 5px**. When `workspaceWidth >= 845px`, show both panes and clamp the requested 60/40 ratio or restored user ratio so neither pane violates its minimum. At exactly 845px, the only feasible allocation is 480/360 plus 5px. Both panes must scroll their own content appropriately; neither forces horizontal document overflow.

Users resize with a visible draggable `separator`:
- Pointer dragging adjusts the split, respects bounds, and terminates cleanly on pointer release or cancellation.
- `role="separator"`, vertical orientation of the separator element, clear accessible name, `aria-valuenow`/min/max and keyboard focus. **ArrowLeft/ArrowRight adjusts list share by two percentage points per keypress**, clamped to pixel limits. Keyboard, touch/pointer support and focus indication must remain usable.
- Keep width as lightweight state owned by the Tasks route layout. Closing/reopening the panel preserves it. Navigating to the canonical task page and back preserves it as long as the Tasks route layout remains mounted. Leaving Tasks for another workspace or reloading resets it to the initial 60/40. **No local/session storage**.
- On workspace resize, clamp the stored ratio to current minimums for presentation; when returning from temporary overlay, restore the last chosen ratio subject to current bounds.

When `workspaceWidth < 845px`, show details in a **modal-style, right-side drawer** over the Tasks list, without a splitter. Use the existing accessible dialog/drawer primitives where appropriate; backdrop, Escape, and Close dismiss to the list URL, focus is trapped inside, and focus is restored to the originating task control when available (otherwise a sensible list target). The list is not interactive behind the modal. The drawer fits the available viewport/workspace without horizontal overflow; its width is capped by the available workspace width. This is a narrower-desktop fallback, not a new mobile design.

### Detail composition

The side panel header shows the readable `TASK-N` key plus working **Open full page** and **Close** controls. Reserve structural space/extension points for Archive/Restore and Delete, but **do not render disabled or decorative controls** until issue #23 supplies real behavior.

The full page uses the same read-only `TaskDetailView`/content sections and query behavior; it has a **Back to Tasks** control and the approved **740px maximum single-column content width** from the signed-off mockup. It need not display a redundant full-page button. Keep the approved hierarchy: task title, description (when present), then supported priority and due-date properties. The complete approved future order is title → description → checklist → priority → due date → tags → attachments → activity; #19 renders only sections supported by production data and its own scope. No fabricated checklist/tags/files/events. Optional metadata may be labeled as unset; an empty description should not show fake content.

Use a single component for read-only task presentation in both surfaces, with surface-specific chrome/layout. The canonical ID is the numeric database task ID; the readable task key is **display-only**, never substituted into a route or API path.

## 4. Routing, selection and browser history

TanStack Router is the source of truth for selection:
- `/tasks`: list only.
- `/tasks?task=123`: list with task 123 selected in a panel or modal drawer, depending on available workspace width.
- `/tasks/123`: canonical full-page detail.
- Never use `#task/TASK-N` mockup links.

**History contract**
1. Opening a row/key from the unselected list **pushes** one new history entry with `?task=<id>`.
2. Switching the selected task while a panel is already open **replaces** that entry; Back should return directly to the previous list/location, not step through every task.
3. When opened from the list, panel **Close** and overlay backdrop/Escape go Back to the preceding list entry, preserving browser Forward to reopen the panel. Do not blindly invoke browser Back when opening context is unknown: for a directly loaded `/tasks?task=...` link, replace/navigate safely to `/tasks`.
4. The panel's full-page control **pushes** `/tasks/<id>`. From this flow, **Back to Tasks** returns to the same selected panel entry and retains its last width; browser Back/Forward behaves coherently. Direct entry to a canonical page, without known origin, falls back to `/tasks`.
5. Preserve originating route context in explicit TanStack Router history/location state (or equivalent route-scoped context), not a global store or guessed browser history depth. The initial #19 UI opens tasks from Tasks; future Today/Inbox/Search entry points must be able to pass a safe origin without implementing those routes now.
6. Reloading either URL must load the same task using the URL. A reload resets the resize width; it must not erase selection. Browser Forward after returning to list must be able to reopen a panel that came from a normal list selection.
7. A malformed, nonnumeric, unsafe or nonpositive task identifier gets a safe unavailable/invalid selection state, not a malformed API call or crash. Unknown numeric IDs use the server's existing 404 contract.

Represent panel ID in validated route search params and full-page ID in a real file-based TanStack Router route. Route nesting or a feature-owned parent layout should preserve the temporary panel width through `/tasks` ↔ `/tasks/$id`, while unmounting/resetting it outside the Tasks experience. Let TanStack Router regenerate `routeTree.gen.ts`; do not hand-edit it.

## 5. Feature ownership, server data and read-only description

Keep all new feature implementation under `client/src/task` and route declarations under `client/src/routes/_authenticated`. Do not move Task business logic to shared app components merely for hypothetical reuse.

Adapt existing `TaskWorkspace`, `TaskSection` and `TaskRow` rather than replacing the working list. Make the row/title/key interaction an accessible click/keyboard target. Prefer a semantic task-opening button with room for future independent completion and action-menu controls; those controls must never accidentally trigger opening details.

Extend `taskApi` with a GET detail request to existing `/api/v1/tasks/{id}` and a typed detail DTO. Fetch detail through TanStack Query, keyed by **current user ID and task ID**; do not fetch until both are valid. The existing backend already ensures user ownership and returns indistinguishable 404 for missing/other-user IDs. Avoid stale previous-task content while selecting a new ID. Do not change existing backend CRUD, response shapes or authentication conventions.

The `description` field is a JSON document with `{"type":"doc","content":[...]}` envelope, possibly null. Render **safe plain text** using a small feature-owned recursive JSON-text extractor with sensible block/paragraph breaks. Display text through normal React escaping. Do **not** use `dangerouslySetInnerHTML`, interpret stored HTML, execute links, or introduce a Tiptap editor/rendering dependency in this story. Preserve the persisted JSON unchanged. Issue #24 will replace the display with validated rich-text rendering/editor behavior.

### Error and empty states

- Loading the selected task: show explicit local loading feedback without falsely presenting old task data.
- Retryable API/network/5xx failure: show a non-destructive message and a retry button in the affected detail surface.
- 404 for missing/deleted/other-user ID: show the same generic task-unavailable feedback, never another user's data or task title; provide safe navigation back/close.
- Invalid ID: show a safe invalid/unavailable state without calling the backend.
- Authentication failure: use existing session/error conventions; do not leak cached detail from a previous user.
- Optional description/priority/due-date values: render honest empty/unset states, no fabricated content.

The Tasks list's existing loading/error behavior remains in place and should not be broken by a separate detail-query failure.

## 6. Component boundaries and implementation outline

Recommended responsibilities (exact filenames can be locked in the subsequent implementation plan):

- **Tasks route layout:** maintains ephemeral split ratio, hosts nested list/full-page routes and origin context, resets on leaving Tasks or reload.
- **TaskWorkspace:** renders current list data and selection, side-by-side workspace vs. overlay fallback.
- **TaskSplitPanel / TaskPanelShell:** shared accessible panel chrome, resize boundary and optional future create/detail modes; only detail mode is active in #19.
- **TaskDetailView:** display-only task data and sections, used by both surfaces.
- **TaskDetailPage:** canonical route wrapper, Back-to-origin affordance and single-column layout.
- **Task detail hook/API/types:** owner-scoped query and response typing; plain-text description extractor as a small pure tested function.

Avoid a generic workspace system, premature abstraction for other objects, or adding dependencies where current libraries suffice.

## 7. Verification and acceptance

Use test-first development and existing Vitest/React Testing Library and Playwright configuration. Adapt outdated issue #17 tests that assumed rows contain no controls, preserving their list behavior assertions.

**Component/router tests**
- Row/title/key selection; keyboard activation; independent completion/menu event boundaries (without implementing those actions).
- Correct push-on-first-open, replace-on-switch, close/back/forward, full-page navigation and return, direct deep link and reload.
- Resize initial/clamped behavior including widths 845px and 844px, arrow keys, pointer lifecycle and canceled drag.
- Resize width retained on close/reopen and full-page round trip, reset on Tasks leave/reload.
- Modal backdrop, Escape, focus trap and focus return; no interaction with underlying list.
- Shared panel/full-page presentation, missing optional metadata, JSON text extraction including nested/unknown nodes and malicious HTML-like strings.
- Rapid task switching and request races; invalid IDs; 404 owner isolation; 5xx/network retry; session changes without cached-data leakage.

**Playwright**
- Log in using existing test infrastructure, open task → panel → canonical URL → Back to selected panel → close.
- Pointer resize and keyboard resize with actual workspace geometry; responsive switch to drawer and dismiss.
- Deep-link/reload for `/tasks?task=<id>` and `/tasks/<id>`, including unavailable ID.

**Final frontend commands (run from `client/`):**
`npm run test`, `npm run test:e2e`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`.

## 8. Risks and scope controls

1. **History loops or wrong origin:** never call Back solely because history length is nonzero; use explicit trusted route context and direct-link fallback.
2. **Layout regressions:** split width is measured after sidebar, not the centered list max-width; preserve list-only presentation and shell overflow behavior.
3. **Security/stale content:** cache is owner scoped and detail selection never renders data for a different task or prior authenticated user.
4. **False functionality:** create/edit/archive/delete/checklist/tag actions stay with their owning issues; reserve composition seams, not disabled fake buttons.
5. **Premature infrastructure:** plain-text extraction is intentionally temporary until #24, and route/layout state remains local rather than introducing global stores.

## 9. Downstream implementation handoff

Only after written-spec review and approval, produce `docs/superpowers/plans/2026-10-18-issue-19-task-detail.md` using the Superpowers writing-plans workflow. The plan must name concrete file paths and interfaces, break work into independently testable steps, specify failing tests before implementations, and include review gates for Luna. Do **not** implement product code as part of this design-document deliverable.
