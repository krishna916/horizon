# Notes mockup verification

**Reviewed:** 2026-11-08, Codex in-app browser. **Result:** interactive design artifact ready for product review; UX approval remains pending.

This is a mockup check, not production end-to-end, backend, authorization or storage validation. No application tests or CI were run because production source and dependencies were not changed.

## Completed browser checks

| Journey                  | Observed result                                                                                                                                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First entry / reset      | Populated collection starts in Cards; Reset restores eight active and one archived sample.                                                                                                                                                                                   |
| View preference          | Cards ↔ List works on the same collection. List stayed selected after editor return and a browser reload; rechecked on final source.                                                                                                                                         |
| Card variants            | Short prose, long prose, image-first, image after cutoff, untitled, title-only, attachment-only, table/code and no-image examples present.                                                                                                                                   |
| Document order           | Kyoto card retains its image after introductory text; the later-image card has **zero preview images**, despite an image in its full document.                                                                                                                               |
| Natural card heights     | At 390 px, observed heights included 112, 329, 344 and 387 px. At 1440 px the tallest seeded card was approximately 413 px, within the 440 px cap.                                                                                                                           |
| Responsive grid          | 1720 px: four columns; 1440: three; 768: two; 390: one. At 768 and 390 px, document scroll width equaled viewport width.                                                                                                                                                     |
| Open and return          | Card, List and native-link keyboard Enter open the full-page editor. Return retained List mode, travel filter and title sort. Scroll restoration is implemented; a dedicated assertion of exact scroll pixels was not performed.                                             |
| Untouched New            | Optional title/content placeholders shown with “Not created yet.” Leaving without editing did not increase the sample collection.                                                                                                                                            |
| Body-only creation       | First body edit allocated a simulated canonical ID, left title empty, showed Saving then Saved, and increased collection to nine.                                                                                                                                            |
| Image-only creation      | First image action allocated the Note before simulated upload; title remained empty. Failure showed Retry image upload; Retry displayed the image and Saved.                                                                                                                 |
| Attachment-only creation | First CSV attachment allocated a Note before progress; after completion, status was Saved and title stayed empty. Rechecked after correcting initial status feedback.                                                                                                        |
| Rich text / links / tags | Formatting and link insertion exercised; tag assignment autosaved. Linked card preview contained no nested anchors and retained one card-opening link.                                                                                                                       |
| Save failure             | Failed save kept the draft; Back opened a guard. Keep editing retained it. Retry reached Saved before return.                                                                                                                                                                |
| Regular uploads          | Mixed PDF/Markdown/CSV upload kept successful siblings and showed independent failure/Retry. Retried Markdown became downloadable.                                                                                                                                           |
| Upload navigation        | Leaving during uploads opened “Files are still uploading”; Retry/wait returned after work completed.                                                                                                                                                                         |
| Inline removal           | Cancel retained the image. With Fail next save armed, confirmed removal retained the image on failure; Retry removed it after success.                                                                                                                                       |
| Keyboard removal         | Backspace on the focused inline figure opened removal confirmation; Cancel retained it.                                                                                                                                                                                      |
| Attachment removal       | Cancel retained CSV. Confirm removed it after the simulated save completed.                                                                                                                                                                                                  |
| File previews            | Image, read-only Markdown with Mermaid, standalone Mermaid, PDF surface and CSV download-only surface reached. Preview failure retained original download; Retry restored the preview.                                                                                       |
| Original download        | CSV original downloaded through its UI action to the local Downloads folder. No personal files were uploaded.                                                                                                                                                                |
| PDF limitation           | Native embed was blank in this in-app browser. The real PDF was generated and visually rendered successfully with Poppler. The prototype’s clearly labeled sample-page fallback displayed the rendered original and retained the native-viewer option and original download. |
| Lifecycle                | Archived collection opens directly into an editable archived note. Restore retained its PDF. Move to Trash showed retained-files feedback and a recoverable Note Undo. No permanent-file Undo exists.                                                                        |
| Empty / loading / errors | Empty workspace, six loading skeletons, workspace Retry and generic unavailable-note surface exercised. Empty scenario clears old tag context.                                                                                                                               |
| Session transition       | Old title count and Note-content textbox count were both zero after simulated session change. Explicit simulated sign-in restored a fresh demo collection.                                                                                                                   |
| Mobile                   | Cards, List, editor and Files inspected at 390 × 844. Toolbar is horizontally scrollable while the page itself is not. Visible keyboard focus captured on file download.                                                                                                     |

The builder review found two gaps (linked card previews and inline-image failure recovery). Both were fixed and rechecked by the reviewer, who reported no further important questions in that focused review.

## Static / asset checks

```sh
node --check docs/design/notes-workspace/mockup.js
client/node_modules/.bin/prettier --check docs/design/notes-workspace/index.html docs/design/notes-workspace/gallery.html docs/design/notes-workspace/styles.css docs/design/notes-workspace/mockup.js docs/design/notes-workspace/*.md docs/design/notes-workspace/assets/*.md
git diff --check
```

Local HTML references and screenshot links were checked for missing files. The fixture PDF’s first page was rendered with Poppler and visually inspected; embedded fonts corrected an initial fallback-font rendering issue. JavaScript source makes no Notes API or remote upload calls. The local bundle includes the font/license, photograph, PDF and rendered fallback, Markdown, Mermaid and CSV originals.

## Screenshot evidence

The [gallery](gallery.html) contains 20 actual browser captures. Desktop review used a 1440 × 1080 viewport override; its exported images are 1425 × 1069. Captures 01–03, 16 and 19 were exported at the recovered tab's default 1265 × 712. Mobile exports are 390 × 844. File dimensions were checked from the JPEG metadata.

| File                                | State                                           |
| ----------------------------------- | ----------------------------------------------- |
| `01-desktop-cards.jpg`              | Dark Cards; varied heights and natural row gaps |
| `02-desktop-list.jpg`               | Same collection as compact List                 |
| `03-desktop-editor.jpg`             | Full-page text/inline-image editor              |
| `04-new-untouched.jpg`              | Optional title, no persisted Note               |
| `05-save-failure-guard.jpg`         | Failed-save navigation guard                    |
| `06-file-removal-confirmation.jpg`  | Confirm/Cancel file removal                     |
| `07-independent-upload-failure.jpg` | Mixed upload results                            |
| `08-markdown-mermaid-preview.jpg`   | Read-only Markdown / diagram fixture            |
| `09-preview-failure.jpg`            | Failed preview with Retry / original download   |
| `10-pdf-preview.jpg`                | Explicit PDF sample-page fallback               |
| `11-archived-workspace.jpg`         | Archived collection                             |
| `12-archived-editor.jpg`            | Editable archive with Restore                   |
| `13-mobile-cards.jpg`               | Single-column Cards                             |
| `14-mobile-editor.jpg`              | Mobile document / scrolling toolbar             |
| `15-light-desktop-cards.jpg`        | Light theme                                     |
| `16-empty-workspace.jpg`            | First-note empty state                          |
| `17-mobile-files.jpg`               | Mobile attachments / download focus             |
| `18-inline-upload-failure.jpg`      | Untitled image-only creation with Retry         |
| `19-session-change.jpg`             | Prior editor hidden during session transition   |
| `20-mobile-list.jpg`                | Compact mobile rows                             |

## Limits and remaining review

- No real API, uploads, authentication, S3, cleanup worker or durable editor persistence exists. Refresh resets sample notes.
- Markdown/Mermaid previews represent only bundled fixtures; arbitrary-file parsing/sanitization is not implemented. Local drops use a fixture, not the dropped file’s bytes.
- The browser editing commands are disposable scaffolding. Native undo involving images is restricted to protect the removal contract; this is not a proposed production editor limitation.
- Storage-blocked fallback and complete screen-reader/reduced-motion runtime behavior were not separately exercised. CSS and semantic affordances are present; production needs dedicated accessibility validation.
- Inbox/Search origin contracts are documented; those workspaces are not implemented here. Exact scroll restoration and every native editor deletion path remain production verification work.
- The scope gate still requires explicit product/UX approval. Authoritative reconciliation changes were proposed, not applied. The reviewer handoff is a local draft, not a posted issue comment.

## Checkout preservation

Design artifacts are isolated on `codex/issue-68-notes-mockups`, based on `14d317c`. The user-approved Impeccable updater installed v4.8.0 and changed local `.agents/`, `.gemini/` and `.codex/hooks.json`; those changes are excluded from the Notes artifact commit. The pre-existing `.codegraph/` and all six stashes are preserved. The Horizon product-knowledge source documents are unchanged.
