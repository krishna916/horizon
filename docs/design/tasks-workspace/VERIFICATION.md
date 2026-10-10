# Mockup verification

Verified on 2026-10-10 in the linked Codex browser, desktop viewport 1280 × 720. No product APIs were called.

## Browser checks

| Scenario | Observed result |
| --- | --- |
| Default view | Active and today's Completed shown; visibility switches off |
| Click task key | Opens the side panel, keeps the list visible |
| Double-click title | Shows that field's editor with Save/Cancel |
| Close with title editor pending | Navigation blocked; Save/Cancel prompt shown |
| Cancel edit | Original title restored; editor removed |
| Save changed priority | New priority appears in both row and details |
| Title-only creation | New key generated; task is first in Active; panel displays its details |
| Complete task | Checked, struck-through task remains in Active; count remains 4 |
| Reopen task | Completion reversed immediately |
| Full-page icon | Single-column dedicated view opened with task hash URL |
| Full-page title edit | Saves successfully with only one active editor in the DOM |
| Checklist checkbox | Immediate check update; no Save/Cancel required |
| Panel divider keyboard resize | List allocation changed from 60% to 58% |
| Archive unfinished task | Only appears in Archived when visibility enabled |
| Restore archived task | Returns to Active |
| Archive completed task | Appears struck through in Archived, retains completion |
| Visibility switches | Independent label clicks toggle the corresponding section/history scope |
| Collapse Active | Rows hidden while section heading/count remains |
| Oldest-first sort | TASK-120 is the first Active row |
| Latest-due-first sort | TASK-122 is the first Active row |
| Reset demo | Starting tasks, sorting and visibility restored |

JavaScript syntax checked with `node --check docs/design/tasks-workspace/mockup.js` (exit 0). Eight JPEG review screenshots captured. Existing app files were not edited; user changes that predated this work remain present.

## Limits

- This is a standalone prototype, not product implementation.
- Data, dates, activity entries, file names and task keys are illustrative. Reference-image date Oct 24 is frozen for reproducible screenshots.
- Search, Capture, global navigation, notifications/help and real Trash navigation are deliberately not wired in this artifact.
- Detail attachment editing simulates file names; creation's file picker retains selected file names without uploading content. Tag entry uses commas. Real editors/storage need a separately confirmed flow.
- Data resets on page reload; generated tasks do not survive reload. Direct links work for the initial reference tasks.
- Checklist, description and attachment treatment is for reviewing geometry and edit affordances; rich-text and file management requirements remain open.
- Completed history control exists, but extra historically completed sample rows were not added while permission to introduce more sample tasks remained pending.
- Minimum pane sizes, resize persistence, sort tie-breakers, initial collapsed states and failure handling remain explicitly unconfirmed in the specification.
- Drag resizing is implemented; keyboard resizing was verified. Drag persistence and breakpoint behavior are not approved requirements.
- Browser testing used the dark tokens matching the current app. No claim of light-theme visual approval or mobile support is made.
- Delete/Undo is implemented as an in-memory demonstration and has not been validated against the real common Trash subsystem.

Krishna approved the screenshots and interactive mockups as the initial design on 2026-10-10. This approval finalizes the brainstorm output. The limitations above and deferred questions in DESIGN-SPEC.md remain explicitly recorded for the separate planning/implementation session.
