# Tasks workspace — approved initial design

Date: 2026-10-10. Owner: Krishna. Intended implementer: Luna.

**Status: approved initial version — brainstorming complete.** On 2026-10-10, Krishna reviewed the mockups and approved them as the initial design. The confirmed interaction brief and rendered visual baseline are finalized for this version. Planning and implementation are explicitly deferred to a separate session. Prototype mechanics and the unresolved behavior listed below are not silently approved by this visual sign-off.

## Read this bundle

- `index.html`, `styles.css`, `mockup.js`: standalone browser mockup.
- `screenshots/`: captured review screens; see `README.md` for the screen inventory.
- `VERIFICATION.md`: browser checks and mockup limitations.

Run from the repository root:

```sh
python3 -m http.server 5184 --bind 127.0.0.1 --directory docs/design/tasks-workspace
```

Then open `http://localhost:5184/`. The top strip contains **review controls**, not product controls. All task changes are local illustrative data. Reset demo restores the starting data. The demo contains no production API integration.

## Purpose and scope — confirmed

Tasks owns reviewing and organizing all tasks. Today owns deciding what to work on next and executing daily commitments. Do not introduce a prioritization dashboard into Tasks.

Use the supplied concept image as a **layout reference only**. Reuse Horizon's existing styles and theme behavior from code. Desktop only for this design round. Deliver interactive mockups, screenshots, and this specification for Luna.

Screens covered: normal list; list plus task details; task creation panel; dedicated task page; history visibility; per-field edit; unsaved-edit prompt; task actions.

## Existing style sources

Reuse these application sources during implementation:

- `client/src/index.css`: light/dark semantic tokens, Geist font, radii and type conventions.
- `client/src/app/layout/AppSidebar.tsx`: existing 256px sidebar, branding, Capture, navigation and footer.
- `client/src/app/layout/AppHeader.tsx`: existing 64px header, task search, notifications and help.
- `client/src/app/layout/AppShell.tsx`: full-height application shell.
- `client/src/components/theme-provider.tsx`: `light`, `dark`, `system`; storage key `horizon-ui-theme`.

The preview is shown with the dark tokens currently visible in the app. It ships the corresponding light tokens too, but does not add a product theme toggle. It mirrors the shell visually; it does not replace the live shell. In production use the existing components and shadcn controls, with existing Lucide icons.

The rendered spacing, metadata styling, row density, section presentation, initial form layout and single-column page width are approved as the initial visual baseline. The panel starts at the explicitly agreed 60/40 split. The existing application theme remains authoritative; the mockup is a visual reference, not a replacement component library.

## List layout — confirmed

The existing global sidebar and Tasks header frame the workspace. Within the task workspace:

1. Heading: **All Tasks**.
2. Subtitle: **Stay organized and clear the path ahead.**
3. Prominent creation entry: **Add a task to Active…** Opening it starts creation in the side panel, rather than typing inline.
4. Sort control and two always-visible, independently controlled visibility toggles.
5. Collapsible sections ordered **Active → Completed → Archived**.

Each task uses a two-line row. First line: title. Second line: task key, due date, priority, tags, and attachment indicator when data exists. Leading completion control; trailing three-dot task menu. The rendered metadata order is part of the approved initial visual baseline.

Clicking the row **or task key** opens the side panel. Neither navigates directly to a full page. Completion and menu controls invoke their own actions without also opening details.

### Visibility

Default view:

- Active tasks visible.
- Tasks completed today visible in Completed.
- Older completed tasks hidden.
- Archived tasks hidden.

Independent controls:

- **Completed history**: includes historically completed tasks in Completed when on. Today's completed tasks remain visible when off.
- **Archived tasks**: reveals the Archived section when on.

The displayed short labels, **Completed history** and **Archived tasks**, are part of the approved initial visual baseline. No fine-grained filtering yet. More detailed criteria can be introduced later. Do not add saved views or persistent filters for V1 without further approval.

All three section headers can collapse their own rows. Initial expansion and whether collapsed state survives navigation are unconfirmed; the demo starts expanded and retains changes while open.

### Sorting

Default: **Newest first**. Available options:

- Newest first / oldest first.
- Due date: earliest first / latest first.
- Priority: highest first / lowest first.

No title sorting. The mockup applies the selected order inside each section. Section ordering remains fixed. Scope, tie-breakers, null handling, and history sort behavior need confirmation before implementation; they are listed below.

## Task identity — confirmed

V1 uses one readable key format, **TASK-123**, across all tasks.

V2 projects introduce custom project-level prefixes. Do not introduce projects into the V1 interface. The key is a readable reference, not a replacement for the existing underlying entity identity. Existing product docs define canonical routes `/tasks/{id}`. How keys are allocated, whether numbering is per user, and whether future prefixes change existing keys are implementation decisions requiring confirmation.

The mockup's hash URLs (`#task/TASK-123`) exist only to demonstrate direct opening of a full-page task in a static artifact. They are not proposed production routes.

## Side panel — confirmed

- Task details appear beside the list, reducing available list width.
- Both details and creation use a **resizable split**.
- Starting allocation: **60% list / 40% panel**, measured across workspace width after the global sidebar.
- A dedicated icon in the details panel header opens the full page.
- Closing the panel returns to the list context.
- Header includes visible Archive/Restore and Delete icons as in the reference, task key, full-page icon and close control.

Confirmed content, in reference order: title; description; checklist; priority; due date; tags; attachments; activity log. Full editing is supported in the side panel.

Full-page and side-panel content have the same functionality. The full page gives more space, not additional capabilities.

### Editing

No Edit button. Details initially read as content. **Double-clicking a field enables its editor.** Each field has its own **Save / Cancel**.

- Save commits that field's draft.
- Cancel discards that field's draft.
- Field blur does not save.
- No automatic saving in this version.
- Task completion and checklist checkboxes update immediately on one click.

Switching tasks, closing the panel, or leaving it while an edit is pending is prevented. Prompt the user to save or cancel the edit. Do not silently discard or save. Whether navigation resumes automatically afterward is still unconfirmed; the demo leaves the user on the task and requires retrying the navigation.

Keyboard activation, simultaneous editors, description rich text, attachment operations, and failure behavior still need confirmation. The demo includes Enter on an editable field as an accessibility demonstration, while preserving double-click for pointer input.

## Creation — confirmed

Opening **Add a task to Active…** shows a creation form in the same side panel.

Fields:

- Title — **only required field**.
- Description — optional.
- Checklist — optional.
- Priority — optional.
- Due date — optional.
- Tags — optional.
- Attachments — optional.

On successful creation, show the **new task's details** in the panel. The task belongs to the Active list. Horizon's existing product distinction applies: creation from a workspace does not enter Inbox; global Capture does.

Activity log becomes relevant after creation; the task key is generated during creation. No auto-save. The Create and Cancel footer presentation is part of the approved initial visual baseline.

Default field values beyond optionality are not approved. Demo starts without priority, due date, tags, checklist content or attachments. Creation-abandonment behavior remains to be confirmed.

## Completion — confirmed

Completing a task immediately checks its control and strikes through its title, but **retains its row in Active temporarily**. This allows another click to reverse accidental completion.

On refresh or leaving and returning to the view, derive the correct section from the saved completion fact. Tasks completed today then appear in Completed. Do not delay persistence merely because the row remains visually in Active.

The exact boundary for ending temporary retention during sorting, toggling, canonical-page navigation, or changing tabs needs confirmation. The mockup retains it during list controls and panel changes, and releases it when returning from the dedicated page or reloading.

## Archive and Trash — confirmed

Both unfinished and completed tasks can be archived. Archived tasks appear **only in Archived**, preserving whether they were completed. Restore returns them to Active or Completed as appropriate. A restored historical completion still respects the completed-history toggle.

Actions:

- Each row has a three-dot menu.
- Details panel and dedicated page have visible Archive/Restore and Delete icons at the top.
- Delete always moves the task to **Horizon's existing common Trash** first.
- No permanent deletion in the Tasks workflow.

The demo's archive/restore updates local data only. Its Trash notification and Undo action illustrate the previously proposed recoverable deletion flow; the owner explicitly confirmed common Trash, but notification/Undo wording and timing are not final.

## Priorities — confirmed

**Critical, High, Medium, Low**, plus **no priority**. Mockup gives Critical neutral emphasis using existing primary colors, rather than introducing the reference image's blue palette. The rendered badge presentation is approved for this initial version.

## Dedicated page — confirmed

A task has a dedicated URL. The side panel's dedicated icon opens that full-page view. For now the page uses **one content column** and the same content order/editing behavior as the side panel. Visible Archive/Restore and Delete icons remain at the top. A two-column page is deferred for reconsideration only if needed.

The Back to Tasks affordance and rendered content width are approved for this initial version. Preserve navigation context according to Horizon's product docs.

## Implementation alignment

Follow `docs/ai/HORIZON_PRODUCT_CONTEXT.md`, `HORIZON_ARCHITECTURE_CONTEXT.md` and the frontend engineering guide. These mockups establish UX, not a backend design.

- Keep lifecycle facts as `completed_at`, `archived_at`, `deleted_at`; no workflow status enum derived from UI section names.
- Deleted takes precedence over archived/completed. Archived takes precedence over completed. Active rows represent incomplete, non-archived, non-deleted tasks plus temporary completed presentation retention.
- Checklist items remain lightweight task-owned actions, not subtasks or project tickets.
- Canonical task identity and readable keys are separate concerns.
- Preserve module-owned API clients, TanStack Router and Query conventions, ownership checks, and existing theme provider.
- Use shared tags and common Trash rather than introducing parallel systems.
- Preserve Today as the execution workspace; projects remain V2.
- Real APIs, attachment storage, activity history infrastructure, migrations, failure states and authorization are outside this mockup artifact.

## Deferred questions for a separate planning session

These are deliberately not silently finalized:

1. Initial visual review is complete: row density, panel spacing, metadata emphasis, form spacing and full-page width are approved. Further refinements require a later review.
2. Initial toggle labels and section count/hint presentation are approved. Whether these need further refinement can be revisited later.
3. Panel resize limits, width persistence and behavior on narrower desktop windows.
4. Whether every section uses the selected sort, plus null placement and tie-breakers. Demo: undated last in both due orders, no priority last descending/first ascending, creation descending for ties.
5. Whether the visibility controls, sorting and collapsed sections reset or survive leaving the workspace.
6. Definition of "today" for completions (user timezone/day boundary). Reference screenshots freeze the date at Oct 24; actual implementation must use the agreed real clock.
7. Completion-retention boundary under sorting/toggles/canonical navigation.
8. Keyboard access equivalent to double-click; whether one or multiple editors may be open. Demo: Enter activates a field, one field at a time.
9. Navigation after Save/Cancel in the blocked-navigation prompt. Demo: remain on the task, retry navigation afterward.
10. Description formatting/rich text and checklist add/remove/reorder rules.
11. Tag input and suggestions, attachment picker/remove/preview behavior, allowed file types/sizes.
12. Activity log event vocabulary, timestamps, grouping and empty state.
13. Dirty creation form cancellation behavior; demo header closure prompts while the explicit Cancel button discards the form.
14. Key sequence allocation and persistence; canonical page route identity remains governed by existing docs unless explicitly revised.
15. Loading, save-failure, retry, permission/missing-task and validation visuals.
16. Additional sample data: permission to introduce fictional tasks was asked separately; no extra fictional task titles were added while that answer remained pending.

## Review and implementation acceptance

Krishna approved the existing screenshots and interactive mockups on 2026-10-10: "Yes, This looks great. we can finalize these as initial version." He explicitly requested that the brainstorm artifacts be committed and that planning/implementation be done separately. No implementation plan is created by this handoff. No product implementation has started.

In the separate planning session, Luna should use these approved screenshots as initial visual targets and this confirmed brief for behavior, resolving the deferred questions with Krishna before dependent implementation. Do not copy the mockup's DOM/event-handling implementation into the production app as a shortcut.

Key acceptance scenarios for the future implementation:

- Default list includes active tasks and today's completions only.
- Visibility controls independently expose completed history and archived tasks.
- Every section collapses without changing lifecycle facts.
- Keys and rows open details, full-page icon opens the canonical destination.
- Initial panel split is 60/40 and can be resized.
- Double-click opens a per-field editor; Save persists and Cancel restores.
- Leaving with an edit open is blocked and prompts Save/Cancel.
- Task/checklist completion is immediate; task row remains struck through until the agreed retention boundary and can be reversed.
- Creation requires only title, offers all optional fields, and opens the new task's details afterward.
- Archive preserves completion, Restore returns the appropriate section, Delete sends to common Trash.
- Dedicated page is single-column and offers the same capabilities as the panel.
