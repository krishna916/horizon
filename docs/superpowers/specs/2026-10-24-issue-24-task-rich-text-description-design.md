# Issue #24 — Task rich-text descriptions: design specification

**Date:** 2026-10-24
**Status:** Draft for owner review; NOT YET APPROVED for implementation.
**Source:** [Issue #24](https://github.com/krishna916/horizon/issues/24), PRD-004 Tasks (FR-015 and related task behaviors), `docs/design/tasks-workspace/DESIGN-SPEC.md`, Horizon Constitution, shared concepts, existing master code.
**Scope:** One vertical slice across Task creation, Task detail editing/read mode, API validation, persistence and tests. This document does not supersede the approved Tasks workspace design.

## Intent

Create, edit and read formatted task descriptions in both the task side panel and dedicated task page. Preserve all nine PRD-004 formatting capabilities and the approved explicit Save/Cancel interaction. Support future Notes import/export through a stable, portable rich-text representation, without building import/export or generic infrastructure now.

## Approaches considered and decision

- **Chosen: Tiptap/ProseMirror JSON in existing nullable PostgreSQL `task.description JSONB`.** Fits the already-shipped storage contract and installed frontend Tiptap stack. The current plain paragraph documents remain compatible.
- **Rejected: sanitized HTML as canonical storage.** Introduces HTML sanitization and trusted-markup portability concerns; makes structural editing and future conversion more complex.
- **Rejected: Markdown as canonical storage.** Does not naturally round-trip all required tables and rich editor behavior, and introduces conversion drift.
- **Chosen: `null` for absence / semantically empty descriptions.** B (persist every empty Tiptap document) has minor uniformity benefits, but not substantial future import/export value; it pushes 'is empty?' parsing to each consumer. Keep the Tiptap empty-doc conversion at one adapter boundary.

**Architectural boundary:** Task-specific editing integration stays in `client/src/task` and validation inside the server's Task module. Small rich-text document/editor helpers may be cleanly separated within that feature for later extraction if Notes needs the same contract; no cross-feature RichText platform, export adapters, document-version registry, or database migration in #24.

## Editor foundation and future compatibility (owner clarified 2026-10-24)

Horizon should feel as close as practical to Notion/Obsidian for the **supported formatting features**, with a Markdown-first authoring experience. The Task implementation is the first consumer of a foundation needed later by Notes, not a one-off textarea replacement.

**Small reusable frontend boundary (proposed for approval):** extract the document schema/Tiptap extension configuration, canonical JSON normalization, view-only rendering, editor presentation and Markdown parsing/paste behavior into cohesive frontend rich-text components/helpers (e.g. `client/src/components/rich-text/`), with task-specific Save/Cancel, navigation guard, creation snapshots and API update logic remaining inside `client/src/task`. Do not expose a generic plugin registry, export service, abstract document repository or backend platform in V1.

**Future revisit list (deferred until Notes or a specifically approved editor enhancement):** slash commands, block drag/reorder, nested document links and `[[wikilinks]]`, backlinks, callouts, attachments/embeds, note-level Markdown import/export workflows, collaborative editing, and richer keyboard navigation. Capture these as *future candidates*, not silent V1 features. Any future Markdown import/export should consume the same approved JSON schema and adapter; do not add exporters in #24.

**Library reality:** Tiptap 3 `@tiptap/markdown` offers Markdown parse/serialize but is currently documented as beta. Integrating it for paste does not automatically implement automatic paste conversion. Verify runtime behavior against actual locked Tiptap version; keep parser behind a local adapter and test core syntax and failure fallback. Avoid paid Tiptap-pro paste-handler dependency unless separately approved.

## Required formatting contract

Round-trip Tiptap JSON for headings, bold, italic, HTTP(S)/mailto links, bullet lists, ordered lists, code blocks, block quotes, and tables. Use only registered and explicitly supported Tiptap nodes, marks, and attributes. Allow ordinary paragraphs/text and hard breaks needed to edit them. Implement link editing and table insertion/basic row/column operations, not just display. A practical editor baseline is headings at levels 2 and 3 so task title retains the page's level-1 heading; this is an implementation proposal for owner review, since PRD names 'headings' without levels. Code mark may be enabled only if configured and validated consistently; PRD explicitly requires code *blocks*.

### Markdown-style typing shortcuts (owner requested, added 2026-10-24)

The editor **must** support immediate Notion/Obsidian-like Markdown input rules **during normal rich-text editing**, in both creation and detail edit mode. This is **not** a Markdown source editor, an import/export format, or a change to the JSON storage contract. Use Tiptap 3 StarterKit's native input rules when supported; add focused custom input rules only if required for confirmed shortcuts. Include component coverage for:

| Input at start of block (followed by Space where applicable) | Result |
| --- | --- |
| `## ` and `### ` | Heading 2 / Heading 3 |
| `- ` or `* ` | Bullet list |
| `1. ` | Numbered list |
| `> ` | Blockquote |
| `--- ` | Horizontal divider |
| `\`\`\` ` | Code block |
| `**text**` | Bold mark via supported inline rule |

**Horizontal divider is explicitly requested beyond PRD-004's nine formatting categories.** Include `horizontalRule` in the supported Tiptap document schema, strict backend allowlist, read-only renderer and tests. Check actual Tiptap v3 trigger behavior against its current docs and test it rather than guessing. Honor the agreed H2/H3 design default; do not silently introduce H1 inside task descriptions without owner sign-off.

### Automatic Markdown-to-rich-text paste (owner confirmed for V1)

- **Required:** When a user pastes recognizable Markdown source, parse it into the same Tiptap JSON nodes/marks as typing/toolbar formatting, and insert it at the current cursor/selection position (not by resetting the entire document). No intermediate Markdown source screen.
- Scope of Markdown structures: headings, bold/italic, safe Markdown links, unordered/ordered/nested lists, fenced code blocks (including multi-line code), blockquotes, horizontal rules and GitHub-flavored Markdown tables. Preserve ordinary line breaks and literal content. Markdown link URLs still pass the safe URL policy.
- Clipboard precedence must avoid destroying meaningful rich HTML: keep supported formatted HTML from rich sources; use Markdown parsing for detected Markdown *source text* in `text/plain`, including common code/plain-text clipboard representations. Do not process the same paste twice.
- Determine whether plain text is Markdown conservatively. Ordinary prose, punctuation and non-Markdown lists must remain ordinary pasted text; for uncertain cases, retain literal text. Include regression examples for literal asterisks, URLs and `---` mid-paragraph. Provide ordinary Undo to reverse conversion and a plain-text paste fallback through the browser/editor keyboard behavior.
- Reuse `@tiptap/markdown` (beta) if it proves compatible and reliable with Horizon's schema; an isolated adapter and tests are mandatory to avoid binding future import/export to a beta API. Tiptap's paste-rule helpers alone are not enough for full multiline Markdown blocks/tables; use schema-aware parser rather than ad hoc regex conversions.
- **Both** creation and detail editor must share this behavior; do not duplicate clipboard handling.
- Invalid/unrecognized input must not crash, run scripts, silently drop content, or corrupt existing document; fall back to safe plain text if parsing fails. Do not weaken the server validator to allow parser output it cannot validate.

Rich HTML paste still preserves supported formatting as already agreed. Paste functionality does **not** imply file-level Notes Markdown import/export in V1.

Do not persist raw HTML or arbitrary pasted CSS/styles/embedded content. Paste content from websites/Google Docs/other editors through Tiptap's supported schema: retain supported markup/text, drop unsupported formatting and unsafe content, and never silently lose plain text. Image embeds, attachments, custom node types and Markdown source mode are out of scope.

## Read and edit UX (owner-confirmed)

1. **Empty task description:** visible muted **Add description…** placeholder; single click activates editor. Enter/Space on the focused affordance does likewise.
2. **Populated description:** safely render formatted content (not plain-text flattened); double-click non-link content to edit. Enter/Space via an accessible edit affordance or keyboard focus activates editing.
3. **Links in read mode:** single-click opens safe HTTP(S)/mailto destination in a new tab using `target="_blank"`, `rel="noopener noreferrer"`. Clicking a link must not accidentally enter edit mode. Invalid link targets never execute.
4. **Editing toolbar:** compact, persistent toolbar while editing (including creation); groups common formatting and less frequent link/table controls, follows existing shadcn/theme styles. Read mode has no toolbar.
5. **Save / Cancel only:** Save sends one `PATCH /api/v1/tasks/{id}` with `{ "description": <document-or-null> }`; Cancel discards draft. Blur must neither save nor discard. A failed save retains the editable draft, exposes a retryable field error, and does not misrepresent server state.
6. **Editing exclusivity:** description participates in the existing one-field-at-a-time interaction and checklist edit-blocking. Do not switch fields and silently discard description changes. Reuse the existing `TaskDraftNavigationGuard` Save/Discard/Keep Editing path when dirty; preserve the same behavior when panel closes, task changes, full page opens or route changes.
7. **Both detail surfaces:** use the existing shared `TaskDetailView`, not separate editor implementations. Completed/archived task descriptions remain editable per PRD.
8. **Creation:** replace the plain-text description textarea with the rich-text editor in `TaskCreateForm`. Description is optional, title remains sole required field. Rich-text changes count toward creation's dirty guard. Preserve pending state, server error presentation, immutability of request snapshot and idempotency key on ambiguous-create retry. On successful create show task detail, as now.

## Empty-content contract

- The persisted absence value is **`null`** for never-entered, cleared or only-whitespace textual content; initialize the editor with a valid empty Tiptap document when loading null.
- Normalize at the editor/API boundary, not ad hoc in every renderer. Empty-text nodes, empty paragraph(s) and whitespace-only text do not create a persisted description.
- **Non-text structural content matters:** an intentionally inserted empty table is not disposable whitespace; preserve it even with blank cells. This is an implementation proposal for owner review to prevent silent structural data loss. Avoid treating a nonempty document as empty merely because its plain-text extraction is empty.
- Use a semantic empty predicate for placeholder state and cancel/save dirty comparison, without confusing Tiptap transient transactions with persisted content changes.
- `PATCH` omitted description leaves it unchanged; explicit `description: null` clears it. `POST` may omit description or send null.

## Validation, security and compatibility

- Introduce **one Task-owned document validator**, reused for creation and partial updates and protected by tests at the domain/application boundary. Existing controller request mapping must not diverge: current PATCH validates only the root `type=doc` and `content=[]` shape; create has no equivalent full web-layer check.
- Accept `null` and schema-conforming `doc` structures. Reject unknown nodes/marks, attributes outside an allowlist, malformed child placement, malformed JSON types, or unsupported nesting. Validate table row/cell structures and supported table attrs in line with the configured Tiptap extensions.
- Validate links: only absolute HTTP/HTTPS and `mailto:`, safe URL parsing, no `javascript:`, `data:`, `vbscript:`, scriptable embeds or event-handler attributes. Open outbound links with safe rel/target. Do not trust previously persisted JSON when rendering; never use unsanitized `innerHTML`.
- Add bounded input checks before deep traversal to avoid resource exhaustion or recursive overflow. **Proposed engineering limits for owner review:** max 256 KiB serialized JSON UTF-8, max 10,000 nodes, max nesting depth 32. These are not yet approved product limits and may be adjusted before implementation.
- Invalid create/PATCH description returns HTTP 400 with the existing field-scoped validation/error contract. Creation still honors user ownership and idempotency behavior; editing preserves 404 for inaccessible tasks.
- Existing Tiptap-style paragraph documents already persisted by `toTaskDescriptionDocument` must remain loadable/renderable/editable. Do not introduce a schema migration or change the `task.description` column.
- Schema validation applies to incoming writes; reading legacy content should not crash the task detail. Provide safe graceful degradation for unexpectedly invalid legacy JSON; do not silently rewrite it.

## Integration and data ownership

- Existing `TaskDetail.description` and `CreateTaskPayload.description` are JSON-or-null; extend `UpdateTaskPayload` with `{description: Record<string, unknown> | null}`.
- Extend `useUpdateTask` cache reconciliation for description and `updatedAt` only after successful server response. Preserve user-scoped query keys, ownership handling and existing invalidation conventions.
- `TaskSummary`/list rows contain no description; keep them that way (PRD-004 FR-022).
- `updated_at` changes when saved description changes; Cancel, blur or failed updates must not change it. Do not add independent rich-text search/indexing in this issue. Future Search should derive plain text from the structured description without replacing the source representation.

## Test and completion contract

- **Document helpers:** null/empty/whitespace normalization, unchanged legacy paragraphs, nested list/table/code/links round-trip, structural blank table preservation, native formatting paste, multiline Markdown source paste with nested lists/fenced code/GFM table/link/divider, conservative detection, plain-text fallback and safe-link handling.
- **Backend unit/integration:** POST and PATCH allow valid supported document, including horizontalRule; invalid node/mark/attrs/types/depth/link/size return existing 400 shape; clear using null; persistence JSONB round-trip through real Postgres/Testcontainers; ownership and metadata preserved; absent patch does not clear description.
- **Frontend component:** Markdown-source paste conversion plus precedence over rich HTML/plain text and Undo coverage, Markdown-style typing shortcuts (headings, lists, quote, divider, code block, inline bold), optional rich create, toolbar formatting and links/table controls, read-only render, empty placeholder single-click vs populated double-click, external links, Save/Cancel/blur, mutation failure retains draft, navigation-guard and mutual exclusion with other fields/checklist, both detail surfaces.
- **E2E as applicable:** formatted create/reload/edit, panel-to-page parity, saved vs cancelled content, no rendered script execution, no list-row description preview.
- Run existing Maven format/static-analysis/test gates and frontend format/lint/typecheck/unit/build/Playwright gates according to the repository workflows. Tests follow Horizon's project conventions.

## Compatibility and risk review

- Do not promise 1:1 Notion/Obsidian feature parity in #24. The target is comparable interaction for **supported** writing formats, live typing shortcuts and automatic Markdown paste. Advanced block-level/Notes capabilities have explicit future follow-up scope above.
- Markdown beta parsing can differ from Tiptap nodes in tables/nested lists; test a representative corpus and reject data-loss behavior. If the beta adapter cannot faithfully meet the agreed V1 formats, surface the limitation for owner review rather than quietly degrading.
- Plain-text clipboard Markdown detection is heuristic. When source is ambiguous, prefer preserving literal content instead of destructive auto-formatting; the owner may later request explicit “Paste Markdown” override if real use cases demand it.
- Current H2/H3-only proposal is **pending owner approval**. Full Notion/Obsidian Markdown expectations may call for `# ` / H1 within descriptions. Do not infer approval of heading level 1 from general comparison language.

## Explicit non-goals

Notes editor; attachments/image embeds; import/export endpoints; Markdown editor mode; draft autosave; blur save; task-status redesign; generic rich-text framework; migration/versioning engine; new database table or column; advanced table formatting; separate rich-text previews in task list rows.

## What the implementer may decide

Exact small component names, toolbar iconography/grouping, focused styling consistent with approved design, internal hook composition, test utility details, and current Tiptap 3 extension APIs. Decisions must not change the approved interactions, on-wire data contract, validation policy, or scope. Verify extension APIs using up-to-date docs/Context7 before coding.

## Approval gate

**Owner review required before an execution plan or product code is produced.** In particular, confirm boundaries of Notion/Obsidian parity (whether `# ` headings, slash menus and wiki-links belong to V1), empty structural-content preservation, numeric validation limits, and Markdown paste behavior. After approval write a granular TDD/commits implementation plan in `docs/superpowers/plans/` on this feature branch, then put Luna's branch/plan/spec execution instructions in issue #24 comments.
