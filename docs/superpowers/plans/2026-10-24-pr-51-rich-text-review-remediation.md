# PR #51 Rich-Text Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the five open review findings on PR #51 without changing Issue #24's approved rich-text product contract; add regression tests and return the existing PR to green CI.

**Architecture:** Make targeted fixes inside the existing Task rich-text validator, shared frontend rich-text components, and Task detail integration. Preserve nullable Tiptap JSON in the existing PostgreSQL JSONB column and the current single-editor/dirty navigation architecture; no new data model, migration, dependency, framework, or separate PR.

**Tech Stack:** Java 25 / Spring Boot 4 / Maven / Testcontainers / PostgreSQL, React 19 / TypeScript / Tiptap 3 / Tailwind 4 / Vitest / RTL / Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-issue-24-task-rich-text-description-design.md` (owner-approved).
**Original plan:** `docs/superpowers/plans/2026-10-24-issue-24-task-rich-text-descriptions.md`.
**Review:** https://github.com/krishna916/horizon/pull/51#pullrequestreview-5639099466 — all five inline review threads, existing PR #51.

## Global Constraints

- **Git:** Work directly in the existing `issue-24-rich-text-descriptions` branch, against the existing PR #51 targeting `master`. **No worktrees** and **no new branch/PR**. Do not merge.
- Verify each review finding against **current HEAD** before making a change. Skip a finding only with documented evidence that it is invalid/already resolved.
- Preserve approved UX: Tiptap JSON-or-`null`, supported Markdown shortcuts and automatic paste, toolbar, panel/page parity, explicit Save/Cancel, safe outbound hyperlinks, dirty guard, task ownership/idempotency. Do not rewrite the editor.
- Preserve supported formatting, semantic empty/structural content, legacy data **without silent deletion**, and security checks on **both** frontend rendering and backend writes.
- Use TDD (failing regression, verify RED, minimal fix, verify GREEN, focused commit) per task. Don't remove assertions or use suppressions to make CI green.
- Prioritize P1 link policy and list markers, then P2 legacy content, dirty-state comparison, Markdown table detection. Keep optional a11y/SonarCloud follow-ups proportionate.
- CI quality gates come from `.github/workflows/ci.yml`. Do not claim a green result until the **post-fix PR head** has completed required checks.

## Review Focus

1. A stored `https://` link with `target="_self"` or `rel="nofollow"` cannot override enforced `_blank` + `noopener noreferrer` while a valid URL-only old link still renders safely (Task 1).
2. Real computed list-marker styles render both bullet and number glyphs in **viewer and editor**, including inside nested lists (Task 2).
3. An unsupported yet non-null historical description shows a non-destructive warning/read-only fallback and cannot be overwritten by clicking `Add description…` (Task 3).
4. Undoing a rich-text edit to equivalent source content (including JSONB key order or Tiptap attr defaults) clears dirty state and removes the navigation guard, without hiding true changed text (Task 4).
5. A single-column Markdown pipe table is converted on paste; ordinary prose, lone separators and malformed tables remain literal, with no data loss or double handling (Task 5).

---

## Change map

| Area | Files | Responsibility |
| --- | --- | --- |
| P1 outbound links | `server/src/main/java/com/krishnamurti/horizon/task/domain/TaskDescriptionValidator.java`; `server/src/test/java/com/krishnamurti/horizon/task/domain/TaskDescriptionValidatorTest.java`; `server/src/test/java/com/krishnamurti/horizon/task/web/TaskControllerIntegrationTest.java`; `client/src/components/rich-text/richTextDocument.ts`; `richTextExtensions.ts`; `RichTextViewer.test.tsx` | Force safe link behavior on **write and render**, without breaking old link marks that only contain `href` |
| P1 list presentation | `client/src/index.css`; `client/e2e/task-rich-description.spec.ts` | Restore scoped bullet/ordered/nested list markers after Tailwind Preflight; assert computed browser CSS |
| P2 legacy documents | `client/src/task/TaskDetailView.tsx`; `TaskDescriptionField.tsx`; `TaskDescriptionField.test.tsx`; `TaskDetailView.test.tsx`; `client/src/components/rich-text/RichTextViewer.tsx` and its tests only if necessary | Separate absent/empty from invalid-but-present data; show safe fallback; block silent overwrite |
| P2 dirty comparison | `client/src/components/rich-text/richTextDocument.ts` and `richTextDocument.test.ts`; `client/src/task/useTaskDescriptionEdit.ts`, `TaskDetailView.test.tsx`; `client/src/components/rich-text/RichTextEditor.tsx` only if a synced-prop reset bug is demonstrated | Stable, schema-consistent document comparisons that preserve content |
| P2 Markdown table detection | `client/src/components/rich-text/markdownPaste.ts` and `markdownPaste.test.ts`; `client/e2e/task-rich-description.spec.ts` if needed | Parse one-column tables and exclude false positives |
| Follow-up verification | `client/src/task/TaskDescriptionField.tsx` and affected tests if a11y issue confirmed; PR thread comments; SonarCloud report | Guard interaction semantics; verify CI; explain separately what coverage metadata means |

### Task 1: Enforce outbound link policy on incoming JSON and read-only rendering (P1)

**Review thread:** https://github.com/krishna916/horizon/pull/51#discussion_r4367852493

**Interfaces:**
- Keep `TaskDescriptionValidator.validateAndCopy(Map<String,Object>)` and `isSafeRichTextHref(href)` signatures unchanged.
- Required rendered link attributes: `href` permitted absolute HTTP(S)/mailto; `target="_blank"`; `rel` contains `noopener noreferrer` (optional `nofollow`).
- Required write policy: accept missing `target`/`rel` for backward compatibility with earlier valid href-only descriptions; **reject** explicit `target="_self"` or explicit `rel` values lacking required `noopener noreferrer`. Null/default mark attributes from Tiptap must remain accepted.
- Rendering must independently force the fixed outbound policy even for already-persisted legacy attrs, not trust whatever was stored.

- [ ] **Step 1 — RED (server):** Add `rejectsOutboundLinkPolicyOverrides()` to `TaskDescriptionValidatorTest` for a valid `https` link with each of `target:"_self"`, `rel:"nofollow"`, and `rel:"noopener"`; expect field-scoped `InvalidTaskException`. Add control test that `{href:"https://example.com"}` and standard generated `{target:"_blank",rel:"noopener noreferrer nofollow"}` pass.
- [ ] **Step 2 — RED (API):** Extend `TaskControllerIntegrationTest` verifying POST and PATCH return existing HTTP 400 `errors.description` for override attempts; verify original description remains unchanged on failed PATCH. No changes to HTTP error shape.
- [ ] **Step 3 — Verify RED:** `cd server && ./mvnw -Dtest=TaskDescriptionValidatorTest,TaskControllerIntegrationTest test`; expect failures for the new cases.
- [ ] **Step 4 — GREEN (server):** Tighten `validateLinkAttrs`: if `target` present and non-null, require exactly `_blank`; if `rel` present and non-null, tokenize case-sensitively and require both `noopener` and `noreferrer` with no unsafe tokens. Reuse existing URI/size safeguards; do not accidentally reject Tiptap's default nullable keys or href-only historical marks.
- [ ] **Step 5 — RED (frontend):** In `RichTextViewer.test.tsx` and `richTextDocument.test.ts` check that normal links are clickable in a new tab with mandatory rel attributes and that a persisted link with safe `href` plus conflicting `target`/`rel` **never renders** as an unsafe anchor. Existing no-script/invalid legacy fallback behavior stays safe.
- [ ] **Step 6 — GREEN (frontend):** Match the frontend link-mark validation to the backend for new data. In the actual Tiptap rendering path, verify against pinned Tiptap 3 whether stored attrs can override `Link.configure` defaults; enforce safe render-time overrides using the smallest extension configuration/custom `renderHTML` adjustment if necessary. Do not strip displayed link text. If an invalid legacy mark cannot be safely rendered, display the existing non-destructive fallback from Task 3.
- [ ] **Step 7 — Verify GREEN:** focused server tests; `cd client && npm test -- richTextDocument.test.ts RichTextViewer.test.tsx`; typecheck. Commit `fix(task): enforce safe rich-text link targets and rel attributes`.

### Task 2: Restore visible bullets and numbering for rich-text lists (P1)

**Review thread:** https://github.com/krishna916/horizon/pull/51#discussion_r4367852490

**Interfaces:** no TS/Java interface changes. CSS only in rich-text scope, not global application list styles.

- [ ] **Step 1 — RED:** Add a browser-level assertion to `client/e2e/task-rich-description.spec.ts` for populated viewer and active editor. On `ul` and `ol`, query `getComputedStyle(element).listStyleType`: expect `disc` (or approved appropriate bullet style) and `decimal`, not `none`. Include nested list structure to detect inherited reset; preserve existing table/blockquote/spacing assertions.
- [ ] **Step 2 — Verify RED:** `cd client && npm run test:e2e -- task-rich-description.spec.ts`; confirm the new computed-style assertions fail against current stylesheet. A jsdom-only DOM presence test is insufficient for this issue.
- [ ] **Step 3 — GREEN:** In `client/src/index.css`, inside existing scoped rich-text component rules, add `.rich-text-content ul { list-style-type: disc; }` and `.rich-text-content ol { list-style-type: decimal; }`; optionally adjust nested marker treatment and `li` alignment only if visually required. Do **not** override global UI menus/task lists.
- [ ] **Step 4 — Verify GREEN:** focused Playwright spec plus any existing formatting tests. Commit `fix(rich-text): restore ordered and unordered list markers`.

### Task 3: Treat invalid-but-present legacy descriptions as unavailable, never absent (P2)

**Review thread:** https://github.com/krishna916/horizon/pull/51#discussion_r4367852496

**Interfaces:**
- Canonical `null` is **only** absence or a semantically empty **valid** document.
- An unsupported historical `task.description` is **present, but unrenderable**, not an empty draft. Keep raw stored JSON unchanged; no automatic deletion/normalization/repair/replacement.
- Continue existing `RichTextViewer` safe unsupported-message fallback. Task details must not enter the normal editor or send `description:null` by accident.

- [ ] **Step 1 — RED:** In `TaskDescriptionField.test.tsx` and `TaskDetailView.test.tsx`, supply `{type:"doc",content:[{type:"futureWidget",attrs:{...}}]}` as task description. Expect **no** `Add description…` placeholder, an understandable read-only unavailable-description message, no normal editor activation, and zero PATCH calls when trying to interact. Ensure truly null/whitespace-only docs still show `Add description…`.
- [ ] **Step 2 — Verify RED:** `cd client && npm test -- TaskDescriptionField.test.tsx TaskDetailView.test.tsx`; expected failure.
- [ ] **Step 3 — GREEN:** Compute supported/valid/present state before `normalizeRichTextDocument` in `TaskDetailView`. Pass a distinct 'unsupported existing content' indication or raw value through `TaskDescriptionField`; render `RichTextViewer` safe fallback, plus a clear non-destructive message if needed. Hide/disable ordinary editing for unsupported historical docs, rather than opening a normalized-null editor. Avoid treating malformed content as editable/blank.
- [ ] **Step 4 — Verify GREEN:** same focused tests and `npm run typecheck`, plus click/keyboard security assertions for invalid legacy JSON. Commit `fix(task): preserve visibility of unsupported stored descriptions`.

### Task 4: Compare rich-text drafts semantically, not by JSON property order (P2)

**Review thread:** https://github.com/krishna916/horizon/pull/51#discussion_r4367852501

**Interfaces:**
- Create a shared helper in `client/src/components/rich-text/richTextDocument.ts`: `richTextDocumentsEqual(a: RichTextDocument|null, b: RichTextDocument|null): boolean`.
- Preserve array and text ordering and every meaningful supported mark/node/attribute. Ignore only insertion order of object keys and schema-equivalent absent/default attributes (check Tiptap 3 schema). Never compare only `getText()`; rich formatting is material.
- Reuse `normalizeRichTextDocument` for actual null-vs-valid-empty semantics without collapsing unsupported content into absence.

- [ ] **Step 1 — RED (helper):** Add tests to `richTextDocument.test.ts`: document objects with reversed key order compare equal; reordered nested link attrs compare equal; `href`/text/heading level/table content changes compare unequal; `null` and a valid empty paragraph compare equal; structurally empty table and `null` compare unequal. Include actual JSONB-vs-Tiptap default attribute variant if reproduced (e.g., explicit nullable `title`/`class`).
- [ ] **Step 2 — RED (interaction):** In `TaskDetailView.test.tsx` or `TasksRouteLayout.test.tsx`, seed task with link marks whose JSON key order differs from editor's. Enter editing, make a real change, Undo to visually identical data. Expect **No changes** and no dirty navigation warning/extra PATCH. Then make a true formatting change and verify Save/navigation guard still work.
- [ ] **Step 3 — Verify RED:** `cd client && npm test -- richTextDocument.test.ts TaskDetailView.test.tsx TasksRouteLayout.test.tsx`; confirm new tests fail.
- [ ] **Step 4 — GREEN:** Implement canonicalized comparison using Tiptap schema-compatible node/mark representations with stable object-property ordering; normalize known default/nullable attrs where Tiptap inserts them. Use it in `useTaskDescriptionEdit` for dirty/baseline comparisons. Avoid modifying stored JSON merely to compare. Confirm this comparison does not unintentionally treat meaningful different marks as equal.
- [ ] **Step 5 — Focused regression:** Review `RichTextEditor.tsx` `lastEmittedDocument`/`setContent` sync. If equivalent parent content with reordered attributes resets the editor or selection, update that component to use the *same* semantic comparison and add an editor test. Do not rewrite controlled-editor state when no actual reset is observed.
- [ ] **Step 6 — Verify GREEN:** tests above + `npm run typecheck` and navigation guard regressions. Commit `fix(task): compare canonical rich-text drafts for dirty state`.

### Task 5: Convert single-column GFM tables on Markdown paste (P2)

**Review thread:** https://github.com/krishna916/horizon/pull/51#discussion_r4367852502

**Interfaces:** retain `looksLikeMarkdown(text: string): boolean` and `createMarkdownPasteExtension()` exports; keep HTML clipboard precedence and cursor/selection insertion.

- [ ] **Step 1 — RED (detector):** In `markdownPaste.test.ts`, expect `looksLikeMarkdown("| Name |\n| --- |\n| Ada |")` and alignment separator `| :---: |` to be true. Expect plain paragraph prose with pipe, `---` appearing mid-sentence, or incomplete/stray separators to remain false.
- [ ] **Step 2 — RED (real parsing):** Use the existing Tiptap editor/`dispatchPaste` harness, paste that one-column Markdown source and assert generated JSON contains a `table` with 1 cell per row and the preserved `Name`/`Ada` text, not merely `looksLikeMarkdown === true`. Confirm both editor serialization and server-compatible JSON if schema permits.
- [ ] **Step 3 — Verify RED:** `cd client && npm test -- markdownPaste.test.ts`; expect failures in single-column cases.
- [ ] **Step 4 — GREEN:** Replace the two-column-only regex in `markdownPaste.ts` with a conservative table detector that verifies adjacent header and separator row and one-or-more pipe columns; do not reinterpret arbitrary pipe text. **First verify** pinned `@tiptap/markdown` parses single-column GFM tables. If its parser does not, do not fake success by returning true and pasting incorrect nodes—report that implementation-library gap and propose the smallest safe solution before diverging from agreed V1 behavior.
- [ ] **Step 5 — Verify GREEN:** focused Markdown tests; optionally add a Playwright paste/reload assertion to `task-rich-description.spec.ts`. Commit `fix(rich-text): recognize and parse one-column markdown tables`.

### Task 6: Accessibility, quality triage, CI, and PR handoff

**Files:** `client/src/task/TaskDescriptionField.tsx` and tests **only if** the semantics issue is verified; no unrelated config changes without evidence. May add tests from Tasks 1–5.

**Interfaces:** No new product feature or storage contract.

- [ ] **Step 1 — A11y review:** Check read-only populated `TaskDescriptionField`: an element with `role="button"` currently wraps nested clickable links. Verify keyboard Tab/Enter/Space and link click behavior. If confirmed problematic, split into a non-interactive reading container (still supports approved double-click on non-link text) and a separate keyboard-accessible 'Edit task description' button/affordance. Keep empty-description single-click and all current UI behavior. Add an RTL/Playwright regression for tabbing to both link and edit control. Do not add an unrelated design redesign.
- [ ] **Step 2 — SonarCloud triage:** Inspect the ten new issues reported for PR #51 and investigate why SonarCloud claims 0% coverage on new code while backend/frontend tests execute. Classify each as relevant defect, false positive, or reporting/config gap. Fix **valid changed-code issues** within this remediation; record coverage setup changes for a separate focused engineering issue if no reliable small fix fits PR #51. Do not claim measured 0% coverage is a real absence of tests. Do not add blanket suppressions or disable checks.
- [ ] **Step 3 — Local full verification:** Run `cd server && ./mvnw verify` (requires Docker/Testcontainers) and `cd client && npm run format:check && npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`. Record pass/fail counts, not guesses. Add any missing regression case exposed by these suites.
- [ ] **Step 4 — Push:** Inspect diff against `master` for scope creep; preserve existing issue/spec/plan docs; commit any remaining focused changes; push to `origin/issue-24-rich-text-descriptions`. No worktree, new branch, new PR or merge.
- [ ] **Step 5 — Verify current CI:** Observe required `backend` and `frontend` jobs and SonarCloud quality gate **for newly pushed SHA**, not PR's earlier successful checks. On failures, inspect logs, fix root cause, rerun affected local tests, push and recheck until green. If external blocker occurs, report it explicitly; don't treat pending/skipped/failed runs as green.
- [ ] **Step 6 — Respond on PR:** For each of the five original inline threads, reply with fix summary, affected test(s), and relevant commit SHA; resolve a thread only once its fix is verified. If the a11y observation or SonarCloud coverage matter is deferred, document rationale and proposed follow-up. Post one succinct PR summary with validation evidence and exact CI job results. **Do not merge PR #51.**

## Final acceptance checklist

- [ ] Five original review findings are fixed or explicitly rebutted with evidence.
- [ ] Required formats show visible list markers after Tailwind Preflight (browser computed styles).
- [ ] Stored link target/rel cannot override approved safe behavior; backward-compatible href-only content works.
- [ ] Unsupported stored descriptions never masquerade as empty and cannot be cleared accidentally.
- [ ] Equivalent rich-text content after edit→undo does not trigger dirty warning or PATCH.
- [ ] One-column Markdown tables paste and serialize correctly without literal fallback when supported; malformed content does not silently disappear.
- [ ] Existing Task create/edit/navigation, Markdown input/paste and JSONB round-trip tests still pass.
- [ ] Local checks and actual post-remediation PR GitHub checks all succeed.
- [ ] PR #51 updated on same branch; discussion threads replied to; no merge.

## Execution guidance

Apply tasks in order, small commits and focused RED→GREEN loops. This is review remediation, **not** a second feature implementation. Use Superpowers plan execution, but **never** create/use an isolated worktree. Ask the owner before any material product-contract change or architectural redesign; independently fix straightforward verified defects. Keep changes narrow and leave unrelated code alone.