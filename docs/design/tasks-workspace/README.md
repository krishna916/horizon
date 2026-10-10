# Tasks workspace mockup bundle

**Approved initial version — brainstorming complete.** Krishna approved the mockups on 2026-10-10. The bundle is the finalized brainstorm output; planning and implementation are deferred to a separate session. Product source has not been changed.

Start here: [DESIGN-SPEC.md](DESIGN-SPEC.md). It records confirmed requirements and explicitly unresolved decisions for Luna.

## Preview

From the repository root:

```sh
python3 -m http.server 5184 --bind 127.0.0.1 --directory docs/design/tasks-workspace
```

Open `http://127.0.0.1:5184/`. Screenshot gallery: `http://127.0.0.1:5184/gallery.html`. Use the top review strip to jump among List, Details, Create, Full page and History. That strip is not part of the product design.

Try clicking a row, double-clicking a field, Save/Cancel, completing and reopening a task, resizing the divider, independently enabling history/archive, collapsing sections, and opening task menus. Data is illustrative and in-memory only. Refresh or Reset demo restores the starting data.

The dedicated-page hash link can be reopened directly for reference tasks, for example `http://127.0.0.1:5184/#task/TASK-123`. Production uses Horizon's canonical route contract, not this artifact's static hash route.

## Screen inventory

These screenshots are approved initial visual targets. Their captured review-strip text says approval was pending because the images were taken before the subsequent sign-off; the approval recorded in DESIGN-SPEC.md supersedes that historical label:

| File | Screen |
| --- | --- |
| `screenshots/01-list.jpg` | Default list |
| `screenshots/02-details.jpg` | Task details alongside the list |
| `screenshots/03-unsaved-edit.jpg` | Save/Cancel navigation guard |
| `screenshots/04-create.jpg` | Creation panel |
| `screenshots/05-full-page.jpg` | Dedicated single-column task page |
| `screenshots/06-details-metadata.jpg` | Panel metadata, attachments and activity |
| `screenshots/07-history.jpg` | Visibility controls and archived section |
| `screenshots/08-completion.jpg` | Temporary checked/struck-through row |

Reference-image task titles are reused. Keys, file names and dates are illustrative; Oct 24 is frozen to match the reference's Today label. Placeholder global navigation, Capture and search are not wired to the live app.
