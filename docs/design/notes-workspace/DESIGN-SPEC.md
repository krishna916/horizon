# Notes workspace — proposed design baseline

**Issue:** [#68](https://github.com/krishna916/horizon/issues/68) · **Epic:** [#4](https://github.com/krishna916/horizon/issues/4) · **Storage direction:** [#55](https://github.com/krishna916/horizon/issues/55)

**Date:** 2026-11-08 · **Status:** Mockup for review; final product/UX approval pending.

**Scope:** A self-contained interactive design artifact. No production Notes implementation, API, storage integration, dependencies or authoritative-document amendments.

## Intent and reference

Help one person keep and rediscover useful information, then write without managing a form. Browsing takes inspiration from Keep; opening a note gives it the space of a document. Horizon keeps its own shell, neutral palette, Geist typography, restrained controls and outline icon language. No notebooks, folders, backlinks, block platform, collaboration or dashboard features.

The live `/notes` placeholder and `/tasks` workspace were inspected in the user’s browser on 2026-11-08. The running app uses the dark theme. Both dark and light review themes use the existing grayscale tokens; the only prominent color comes from sample document content. The serif Horizon wordmark, 256 px sidebar and 64 px application header follow the current shell. `docs/design/tasks-workspace/` supplied the self-contained-artifact precedent and licensed Geist font.

## Decision register

“Confirmed” means accepted in issue 68 / issue 55 or explicitly chosen during this review. “Proposed” means an agent recommendation shown in the mockup, still needing approval. “Open” means a consequential unresolved choice. Generating or committing this artifact does not approve it.

| Status    | Decision                                                                                                                                                      | Basis / rationale                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confirmed | Card View and List View use the same collection; first use defaults to Cards; remember last selection on that device.                                         | Issue 68 §1.1.                                                                                                                                                                                                               |
| Confirmed | Clicking any card/row, or New Note, opens the full-page editor directly. No Notes inspection overlay or side panel.                                           | Notes-specific exception in issue 68.                                                                                                                                                                                        |
| Confirmed | Persisted route `/notes/{id}`; preserve origin on return.                                                                                                     | Issue 68; Tasks behavior is unchanged.                                                                                                                                                                                       |
| Confirmed | Title optional; `Untitled note` is a display fallback only.                                                                                                   | The empty title field stays empty; rendering never creates or saves a note.                                                                                                                                                  |
| Confirmed | Meaningful text, title, image or attachment can create a valid note; untouched New creates nothing.                                                           | Persist the Note before any upload.                                                                                                                                                                                          |
| Confirmed | Card preview starts at the document beginning, preserves order and image position, and never looks ahead for an image.                                        | Short, long, image-first, late-image, title-only and attachment-only samples are included.                                                                                                                                   |
| Confirmed | Natural card heights with a cap.                                                                                                                              | No equal-height card stretching.                                                                                                                                                                                             |
| Confirmed | Inline images and regular attachments belong to Notes V1; files retained in Archive and Trash.                                                                | Issue 55 / issue 68, not a File-module implementation authorization.                                                                                                                                                         |
| Confirmed | Both file and inline-image removal require confirmation, including keyboard deletion, then a successful document save before removal. No permanent-file Undo. | Issue 55.                                                                                                                                                                                                                    |
| Confirmed | **Compact visible formatting toolbar.**                                                                                                                       | Krishna selected this in the 2026-11-08 review. Selection-only formatting was considered; visible controls improve discoverability and touch access.                                                                         |
| Proposed  | Separate Active / Archived collection buttons with counts.                                                                                                    | Makes the active collection clear and avoids browsing a mixed grid. Replaces PRD-005’s collapsed archive section only if approved.                                                                                           |
| Proposed  | Row-major CSS grid: 4 columns at ≥1600 px; 3 at 1221–1599; 2 at 601–1220; 1 at ≤600.                                                                          | Breakpoints use viewport width; shell collapses separately. DOM, visual and keyboard order agree. Visible gaps are an intentional review topic.                                                                              |
| Proposed  | 20 px grid gaps; approximately 21 px card padding; **440 px overall card cap**.                                                                               | Bounded scanning without making short notes artificially tall. Preview is capped at 265 px desktop / 240 px mobile, with a fade at the boundary.                                                                             |
| Proposed  | Prototype bounds the preview to the first 520 text characters / six top-level blocks, before applying the visual height cap.                                  | Illustrates a strict beginning-of-document limit. A production renderer must preserve rich-text semantics and grapheme boundaries.                                                                                           |
| Proposed  | Card title 18 px; preview prose 16 px; up to two tag chips plus overflow count; date and separate file/image indicators in footer.                            | Attachments stay metadata, outside the document preview. An image-count indicator may exist even when its image is beyond the preview.                                                                                       |
| Proposed  | Compact list: title, one-line excerpt, tags, file count, updated date; no thumbnail.                                                                          | Content stays easy to scan. Tags/file column progressively collapse on narrow widths.                                                                                                                                        |
| Proposed  | Last updated descending by default; oldest updated and title sorting as small alternatives.                                                                   | Default follows PRD-005 FR-016. No saved filters or named views.                                                                                                                                                             |
| Proposed  | Per-user/per-browser lightweight view preference; only `cards\|list` stored for view choice.                                                                  | Graceful session-only behavior if storage is blocked; no backend setting or cross-device sync. Prototype namespace uses a fictional `demo-user`. Review theme preference is separate and is not a Notes product requirement. |
| Proposed  | `/notes/new` before creation; replace with `/notes/{id}` after first meaningful edit.                                                                         | Avoids duplicate Back entries and preserves editor/caret. Prototype uses equivalent hash routes for static serving.                                                                                                          |
| Proposed  | Document column: 808 px outer width, 736 px text width, title → tags/date → toolbar → body → Files.                                                           | Readable prose, metadata secondary, attachments distinct from inline content. Toolbar scrolls with the document; the Back/save/action row stays visible.                                                                     |
| Proposed  | 900 ms idle debounce; `Saving…`, `Saved`, `Save failed` plus Retry in the top action row.                                                                     | Quiet feedback without a Save form. Delay is a mockup tuning choice, not an API contract.                                                                                                                                    |
| Proposed  | On unsaved/in-flight navigation: stay, or retry/wait and leave when complete. No silent discard path.                                                         | Failed saves retain edits; uploads remain independent. Browser refresh/close gets the browser’s native warning.                                                                                                              |
| Proposed  | File previews use a modal dialog, with original download always available.                                                                                    | Keeps the writing position; this dialog previews a file, never a Note.                                                                                                                                                       |
| Proposed  | File removal keeps the file visible while saving; a failure retains it until retry succeeds.                                                                  | Avoids suggesting that permanent removal completed before the updated Note was saved.                                                                                                                                        |
| Proposed  | New tag input is staged in a selector; Apply tags makes the assignment meaningful.                                                                            | No new Tags workspace or tag administration.                                                                                                                                                                                 |
| Open      | Accept the grid’s row gaps and proposed card cap, or request a layout revision.                                                                               | Masonry adds ordering/accessibility complexity and is not currently recommended.                                                                                                                                             |
| Open      | Approve Active / Archived buttons instead of the PRD’s collapsed archive section.                                                                             | A real product-doc amendment is needed.                                                                                                                                                                                      |
| Open      | Final approval of sizing, responsive shell treatment, autosave delay, guard wording and file preview surface.                                                 | These are proposals, not locked by the initial issue.                                                                                                                                                                        |
| Open      | Production session-expiry recovery for unsaved content, without cross-account leakage.                                                                        | Prototype hides content and requires an explicit simulated sign-in; production recovery behavior needs its own security/session design.                                                                                      |

### Approaches considered

1. **Row-major cards + full-page document + visible toolbar — recommended baseline.** Matches all locked navigation decisions, has predictable reading order and discoverable formatting. Trades denser packing for simpler layout and keyboard behavior. The toolbar portion was explicitly selected; overall visual approval is pending.
2. **Masonry cards + selection-only toolbar.** Packs short cards more tightly and reduces editor chrome. Adds ordering, focus and touch-discovery costs. The selection-only toolbar was not chosen. Masonry remains deferred unless row gaps prove unacceptable.

Tasks’ split panel was ruled out by the confirmed Notes-specific navigation decision, rather than treated as an alternative.

## Interaction and state contracts

### Browse and return

- Active is the default collection. View mode is shared by Active and Archived. Tags and sort are in-memory context only.
- Every card/row is a native link. Tab follows row-major order; Enter opens directly into editing. A title-only note remains compact; an attachment-only card shows a fallback heading and file metadata with no invented body preview.
- Return preserves collection, view, filter, sort and scroll for this visit. Browser Back uses the same save/upload guard. Direct unknown IDs show a generic unavailable message without revealing ownership.
- Canonical production URLs are `/notes` and `/notes/{id}`. This artifact uses `#/notes` and `#/notes/{id}` so a plain static file server works. Future Inbox/Search origins are a navigation contract, not implemented workspaces in this prototype.

### Create, write and save

```text
New → untouched /notes/new → no record
First meaningful title/body/tag/file/image change → allocate Note ID
Text changes → Saving… → Saved
                    └→ Save failed → Retry → Saved
First file/image action → allocate Note ID → start upload
```

- Whitespace or fallback rendering creates nothing. Title-only, body-only, image-only and file-only notes are valid.
- Creating the ID replaces the ephemeral route without rebuilding the editor. The mockup keeps all content in memory; no Note content is written to local storage.
- Formatting includes headings, bold/italic, links, lists, code blocks, quotes and a sample table. Source uses browser `contenteditable` / editing commands as disposable mockup scaffolding; production should reuse Horizon’s existing rich-text foundation. This is not a new editor-library decision.
- Inline image insertion demonstrates the selected document position. Paste/drop uses a sample fixture; no personal file bytes are read or sent. A new note exists before its simulated upload starts.
- Failed or in-flight edits cannot silently disappear through the prototype’s note navigation. Closing/reloading the browser prompts while changes are in flight. Refreshing the mockup resets sample content; it is not durable storage.

### Files

- File rows live after the document. Each shows filename, type, size, upload progress or failure, Download and Remove. Retry affects one upload, not successful siblings or saved text.
- Approved allowlist: JPEG/JPG, PNG, WebP, GIF, PDF, DOCX, XLSX, PPTX, TXT, MD, CSV, MMD and MERMAID; each file **under 20 MB**. Exact byte semantics remain an implementation decision in #75. SVG, HTML, executables and macro-enabled Office are excluded.
- Image, native PDF, read-only Markdown with Mermaid, and standalone Mermaid previews are represented. Office/TXT/CSV are download-only; a real CSV fixture demonstrates that surface. Every preview retains original download and a recoverable failure state. The in-app browser left the embedded native PDF area blank during review; an explicitly labeled **Show sample page** fallback uses a local rendered page. That fallback is review scaffolding, not a PDF-rendering library decision.
- Markdown/Mermaid in this prototype are pre-rendered representations of bundled fixtures, not parsers or authoring support. Native PDF display depends on the browser; original download remains available.
- Individual removal: confirmation → saving updated document/association → logical success. Cancel preserves the file. Failed save preserves the file and Retry completes removal. An inline figure intercepts Delete/Backspace and cut; selection replacement involving images and image drag are blocked and direct users to confirmed removal. Native history commands involving images are restricted in this disposable editor. Production must cover editor transactions through the same confirmation contract without relying on this scaffolding.
- Archive and Trash preserve associated files. Archive remains editable and restorable. Move to Trash has mock recovery feedback; this Undo restores the Note, not a permanently removed individual file. No Trash workspace or permanent parent deletion is built here.
- Real authenticated routing, authorization, streaming, validation, sanitization and eventual object cleanup belong to #75–#80.

### Failure and privacy

Workspace loading uses quiet skeletons. Empty state offers New Note; empty filtered results offer Clear tag filter. Workspace error offers Retry. A missing/inaccessible Note uses the same generic message and a safe route back.

The review strip can simulate a failed save, mixed uploads, failed preview, unavailable ID and session transition. Session transition cancels asynchronous work, hides the prior document and requires an explicit simulated sign-in before resetting demo state. No previous content is displayed under a different demo session. Real session handling and durable recovery are unimplemented.

## Responsive and accessibility rules

- Desktop keeps the existing 256 px sidebar. At ≤900 px it reduces to an icon rail; at ≤600 px it is hidden. This is a **Notes mockup proposal**, not a change to the production app shell or mobile global navigation. The persistent Notes header and Back action remain.
- Mobile Cards become one column; List keeps title/excerpt/date. Title becomes 30 px and body 16 px. Toolbar remains horizontally scrollable; all commands remain keyboard reachable. Main actions use text labels; icons have accessible names and visible focus rings.
- Dialogs use native modal semantics, focus containment, Escape and Cancel/Close; confirmation starts with Cancel focused. Save feedback is a polite live region; errors use an alert. Upload progress exposes a progressbar value. Images have meaningful alt text. Ineligible nested controls are removed from card previews.
- Both themes use grayscale tokens. Muted prose was darkened in light mode to avoid low contrast: `oklch(.46 0 0)` on white is approximately 7.1:1; dark muted text `oklch(.74 0 0)` on the card surface is approximately 8.0:1. Reduced-motion CSS disables transitions.
- Minimum full-page authoring width tested is 390 px. Touch and screen-reader validation beyond the browser checks below remains required before production.

## Authoritative-document reconciliation proposal

The following documents were actually read from the available **Horizon product knowledge directory**. That directory is not a Git checkout in this environment. No accepted product or architecture document was edited.

| Document / exact location                                                     | Current text / conflict                                                                                    | Proposed amendment for review                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `50-AI/ChatGPT Context/HORIZON_CONSTITUTION.md` §2.4, **Object Navigation**   | A universal List → Side Panel → Full Page rule.                                                            | Keep Tasks’ existing rule; explicitly exempt Notes: Cards/List → direct full-page canonical editor. Preserve origin/context requirements. Keep detailed Notes UI out of the Constitution.                                                           |
| `10-Product/V1/PRD 000 Horizon V1 Scope.md` §9, **Object Navigation Pattern** | Explicitly applies side-panel-first to both Tasks and Notes and calls the side panel primary.              | Split the workspace rules, retaining Tasks and recording the Notes exception. Keep canonical routes unchanged.                                                                                                                                      |
| PRD-000 §7, **Notes**                                                         | Rich text and autosave only; optional titles, browsing preference and image/file inclusion absent.         | Add optional title + display fallback, Cards/List with device-local last mode, direct editor, inline images and private Note-owned attachments. Clarify view preference does not introduce saved views/persistent filters or cross-device settings. |
| `10-Product/V1/PRD-005 Notes.md` FR-003 and §9 **Required Product Data**      | Title required.                                                                                            | Title optional; nullable/empty representation settled in story design; fallback display-only. Any meaningful title, body, image or file may create a note; untouched editor creates nothing.                                                        |
| PRD-005 FR-004/005/006                                                        | Direct editing/autosave/rich-text foundations exist, but creation, upload and save-error rules are absent. | Extend with first-meaningful-change creation, Note-before-upload, images in rich text, independent failures/Retry and guarded unsaved navigation. Preserve existing formatting scope.                                                               |
| PRD-005 FR-008 and §8 **Structural Layout**                                   | Collapsed Archived section by default.                                                                     | If the proposed collection buttons are approved, replace only the presentation rule. Keep active default and archived notes editable/searchable/restorable.                                                                                         |
| PRD-005 FR-017/018; §8 **Navigation Model**; §12 **Navigation Rules**         | Requires Notes Side Panel + Full Page, with parity; clicking a Note opens the panel.                       | Replace with direct full-page opening from either browse mode. Preserve origin and canonical routes. Remove Notes panel-parity wording.                                                                                                             |
| PRD-005 §8 **Note List Item**                                                 | One item representation with a 2–3-line preview.                                                           | Define two modes: bounded document-first card preview with in-position images, and one-line compact list excerpt; no promoted cover. Natural height with cap.                                                                                       |
| PRD-005 §10/13 **States & Behaviors / Edge Cases**, FR-009–011                | Existing lifecycle preserves Note content; no file-retention/removal contracts.                            | Add file retention through Archive/Trash, confirmed individual file/image removal only after save, and eventual cleanup only at individual removal or permanent parent deletion. Do not implement Trash here.                                       |
| PRD-005 §15 **Future Considerations: Rich media support**                     | Broad future-only phrase could conflict with accepted Notes V1 images/files.                               | Explicitly scope inline images and approved attachments/previews into V1; leave embeds, media editing, public sharing and other media expansion deferred.                                                                                           |
| PRD-005 new file requirements                                                 | No accepted type/size/privacy/preview policy in the draft.                                                 | Add #55’s approved under-20-MB allowlist, authenticated private access, preview/download matrix, independent failures and confirmation. Link the future File ADR rather than fixing unresolved storage internals in a PRD.                          |
| Application mirror `docs/ai/HORIZON_PRODUCT_CONTEXT.md` §7                    | Also applies List → Panel → Page to Notes.                                                                 | After authoritative amendments are approved, update the compressed mirror and index where needed through normal documentation governance. No mirror was silently rewritten.                                                                         |

PRD-005 FR-016’s updated-date default, FR-019’s editable archive, FR-020’s separation of editing/review, tag filtering and independence from Tasks remain aligned. Search participation remains title/content only; attachment content/filenames and Stage-07 search implementation are deferred.

**Governance sequence:** obtain explicit approval of this Notes baseline and proposed amendments; edit the authoritative PRD/Constitution deliberately with version/change-log updates; propagate approved mirrors; record final approval and artifact references in issue 68 and Epic 4. File architecture details additionally require #75’s ADR and S3 compatibility proof. This reconciliation checklist is not approval to apply amendments.

## Run, scenarios and limitations

From the Horizon root:

```sh
python3 -m http.server 5185 --bind 127.0.0.1 --directory docs/design/notes-workspace
```

Open [the prototype](http://localhost:5185/) and [the screenshot gallery](http://localhost:5185/gallery.html). It can also be opened from `index.html` directly; a local server is recommended for native PDF viewing.

The top review strip is **not product UI**. It selects populated/empty/loading/error/editor/save failure/mixed upload/preview failure/unavailable/session scenarios. **Fail next save** arms a failure without changing the current editor; use it to test removal recovery. Reset demo restores sample notes and first-use Cards. View and review-theme preferences are the only local-storage writes; content is memory-only.

Fixtures: generated garden photograph; a real one-page sample PDF; real MD, MMD and CSV originals; pre-rendered fixture diagrams; bundled Geist font and license. All are local. No CDN or Notes API calls. Arbitrary file rendering, full editor semantics, actual uploads, durable persistence and real authentication are outside the mockup.

See [VERIFICATION.md](VERIFICATION.md) for completed browser checks, evidence paths and limits. Review screenshots correspond to this runnable artifact.

## Reviewer checklist and approval record

- [ ] Approve workspace hierarchy, density, card cap and row gaps.
- [ ] Approve Active/Archived collection navigation and updated-date default.
- [ ] Approve editor width, metadata placement, toolbar and Files placement.
- [ ] Approve creation, autosave, navigation guard and file failure/removal wording.
- [ ] Approve file dialog and mobile behavior; settle any remaining product choices above.
- [ ] Approve authoritative-document reconciliation amendments separately before applying them.
- [ ] Record explicit product/UX approval in #68 and cross-link final artifacts from Epic #4.

**Current record:** compact visible toolbar chosen by Krishna on 2026-11-08. Overall visual/interaction approval remains pending. No production work is authorized by this artifact.
