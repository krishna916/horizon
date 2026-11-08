# PR #84 — Bounded Note Preview Construction Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Luna execution instruction:** Use **superpowers:executing-plans, inline only; no subagents**. The present change is **planning and GitHub handoff only**; implementation requires Luna to execute the steps on the existing PR branch. Do not merge PR #84.

**Goal:** Remove the potentially quadratic trim-and-revalidate loop from Note structured preview generation without changing the approved #69 Notes API or display contract.

**Architecture:** Keep preview generation as a pure Note-domain Java transformation of validated Tiptap JSONB. Traverse source nodes in document order, carrying both text and serialized-byte budgets while constructing a valid prefix; stop when the next source content cannot fit, instead of building an oversized tree and removing descendants one by one. Validate the completed preview once as a final safeguard.

**Tech Stack:** Java 25, Spring Boot 4.0.6, Jackson 3, JUnit 5/AssertJ, MockMvc, PostgreSQL/Testcontainers and Maven verification.

**Spec:** [Issue #69](https://github.com/krishna916/horizon/issues/69), [original #69 plan](./2026-11-08-notes-core-api.md), [PR #84 review-remediation plan](./2026-11-08-pr-84-review-remediation.md), [accepted Notes design](../../design/notes-workspace/DESIGN-SPEC.md), repository `server/AGENTS.md`, `.agents/skills/align-context/SKILL.md` and `docs/ai/INDEX.md`.

## Global Constraints

- **Scope:** Only `server/src/main/java/com/krishnamurti/horizon/note/domain/NotePreviewBuilder.java` and the existing Note preview tests, plus a small HTTP list regression **only if needed**. No migrations, dependencies, other modules, product docs, API changes or changes to CodeRabbit's already-resolved threads.
- **Current reviewed PR head:** `8730aff93aa7c7ee056c2d6510f9ea8dd40bdf3c`, branch `feature/69-notes-core-api`. Recheck PR head before editing; if changed, verify this loop still exists before applying the plan.
- **Original document-order contract:** Preview is the earliest prefix of source content; never skip a too-large early child to promote later text, blocks, or future image nodes. Preserve retained marks, attrs and nested ordering and do not fabricate HTML.
- **Limits unchanged:** At most **six top-level blocks**, **520 Java String text units** (preserve current grapheme-safe truncation; do not split emoji sequences), and **16,384 serialized UTF-8 bytes**. Hit whichever cutoff comes first. No rich-text document in the list DTO beyond bounded preview; detail still returns full content.
- **Validity unchanged:** Output is `null` when no meaningful preview is possible; otherwise it is a structurally valid Tiptap `doc` accepted by `NoteContentPolicy.validateAndCopy`. Preserve valid `listItem` / `tableRow` / `tableCell` requirements. Empty tables/horizontal rules retain existing meaningful-content semantics.
- **Performance target:** For a validated document of up to 10,000 nodes and max depth 32, avoid repeated scans/serializations of an accumulated candidate after removing individual descendants. Aim for total work proportional to the visited input nodes plus retained output, with bounded extra work per nesting level (depth <=32). The 16-KiB byte budget should halt traversal early when exhausted.
- **Do not overengineer:** No cached/persisted previews, no SQL extraction, no JMH dependency, no generic rich-text infrastructure, no new event processing, and no wall-clock timing threshold in CI.

## Review Focus — required regression cases

1. **Oversized first paragraph:** `doc > paragraph > text("lead") + 9,000 hardBreak` produces a nonnull valid preview beginning with "lead", <=16 KiB, and does not scan/promote a later sentinel paragraph (Task 1).
2. **Rich nested structures:** `blockquote`, `bulletList > listItem > paragraph`, `table > tableRow > tableCell > paragraph` preserve required ancestors; a node too large to fit must not yield an invalid tree (Task 1).
3. **Byte accounting accuracy:** JSON metadata/attrs, text with quotes/backslashes/control characters, multi-byte Unicode and marks consume the correct UTF-8 serialized bytes; result never exceeds 16 KiB (Task 1).
4. **Text/structure cutoffs:** six-block cutoff, 520-unit cutoff and grapheme safety remain, including documents where byte cap hits first (Task 1).
5. **API integration:** A collection page with multiple dense-content Notes returns bounded previews and counts/owner filtering; full content remains available through detail GET (Task 2).

---

## File ownership map

| File | Responsibility |
|---|---|
| `server/src/main/java/com/krishnamurti/horizon/note/domain/NotePreviewBuilder.java` | Replace `fitBlock` + `removeLastDescendant` retry loop with byte-aware prefix construction, preserve public `build` signature |
| `server/src/test/java/com/krishnamurti/horizon/note/domain/NotePreviewBuilderTest.java` | Dense-node, nested, byte-accounting and prefix-validity regressions |
| `server/src/test/java/com/krishnamurti/horizon/note/web/NoteControllerIntegrationTest.java` (optional modification) | HTTP list/detail regression with dense blocks if not sufficiently covered already |
| Other code | Do not change unless a verified bug prevents meeting the above, and explain before expanding scope |

## Task 1 — Budget-aware preview builder with worst-case regression

**Files:**
- Modify: `server/src/main/java/com/krishnamurti/horizon/note/domain/NotePreviewBuilder.java:18-125`
- Test: `server/src/test/java/com/krishnamurti/horizon/note/domain/NotePreviewBuilderTest.java:16-170`

**Interfaces:**
- Preserve `public Map<String,Object> build(Map<String,Object> document)`.
- Internal budget should account for `remainingTextUnits`, `remainingUtf8Bytes`, top-level blocks and a `stopped` state. Implementation-specific helper names are free to change, but no externally observable DTO or format changes.
- Reuse Note-local JSON byte calculation semantics from `NoteContentPolicy.serializedJsonSize(Object)` for local component sizes and one final output-size assertion, **not** repeated full-candidate measurement after each removed node.

- [ ] **Step 1 — Write regression tests:** Add `truncatesNearTenThousandNodeFirstBlockWithoutPromotingLaterContent`. Input: one paragraph with `text("lead")` followed by **9,000** `hardBreak` nodes, plus second paragraph `text("later-sentinel")`. First assert `NoteContentPolicy.validateAndCopy(source)` accepts input. Then assert nonnull preview, first text "lead", no "later-sentinel", one top-level paragraph, valid schema, retained breaks are a **proper prefix** of input, and Jackson 3 UTF-8 serialized length <=16,384. Keep existing preview tests.
- [ ] **Step 2 — Add structural/serialization tests:** Use valid nested list, quote and table with mandatory children and valid marks/attrs; include a large inline text plus hard breaks and an escaped/Unicode-heavy text sample. Assert valid prefix/ordering, <=520 UTF-16 text units, <=6 top-level blocks, no torn grapheme, <=16 KiB actual Jackson 3 bytes. Include one case where a required parent/child skeleton cannot fit and ensure it stops cleanly rather than skipping to later blocks.
- [ ] **Step 3 — Establish RED/performance baseline:** Run `cd server && ./mvnw -Duser.timezone=UTC -Dtest=NotePreviewBuilderTest test`; new correctness regressions may already pass against the slow implementation. Capture a **non-gating** before-change benchmark for 1,500 vs 9,000 breaks (warm up, multiple iterations, summarize medians) and inspect that `fitBlock` calls a full candidate size+validation per removed descendant. Do not require a flaky wall-clock failure to make a valid performance change.
- [ ] **Step 4 — Replace the quadratic algorithm:** Build child nodes in original order while maintaining a serialized-byte budget. Reserve the JSON container/key/list separator and closing overhead for each accepted ancestor (including root); count marks, attrs, text escaping and UTF-8 correctly. For each leaf, append only if it fits; for text leaves, take the largest safe grapheme prefix fitting **both** remaining character and byte budget. For compound nodes, use a small rollback/checkpoint if their mandatory child structure cannot be completed. On first exceeded budget, stop at that source position (do not skip to later siblings). Avoid rebuilding or revalidating the full prefix for every accepted child, and remove `fitBlock`/`removeLastDescendant` once no longer needed. Keep maximum recursion bounded by the already validated 32-level schema.
- [ ] **Step 5 — Validate once and verify complexity shape:** At the end, check `NoteContentPolicy.validateAndCopy(preview)` and exact serialized size **once** on the finished candidate, then return it or `null` according to meaningful-content semantics. If final validation unexpectedly fails, correct construction/ancestor rollback rather than scanning/shrinking the candidate in a loop. Confirm by source inspection that no loop repeatedly rechecks the growing whole preview after removing one child, and that traversal stops at byte cutoff. If helpful, use a small package-private visit counter in a test *only if it can be added without polluting the public API*; do not introduce production metrics solely for a test.
- [ ] **Step 6 — GREEN and performance comparison:** Run `cd server && ./mvnw -Duser.timezone=UTC -Dtest=NotePreviewBuilderTest test`. Repeat the same non-gating benchmark from Step 3. Report median timings/scale ratio with system context; do not set fragile CI performance thresholds. Require no large nonlinear growth and verify previous and new result invariants. Commit focused changes: `git add server/src/main/java/com/krishnamurti/horizon/note/domain/NotePreviewBuilder.java server/src/test/java/com/krishnamurti/horizon/note/domain/NotePreviewBuilderTest.java && git commit -m "perf(notes): construct bounded previews without repeated rescans"`.

## Task 2 — Verify browse contract and PR readiness

**Files:**
- Test/modify only if needed: `server/src/test/java/com/krishnamurti/horizon/note/web/NoteControllerIntegrationTest.java`
- No additional production files.

**Interfaces:** List remains `GET /api/v1/notes` with `items[].preview`, `page`, `size`, `hasNext`, `counts` and no full `content`; detail `GET /api/v1/notes/{id}` retains complete rich-text content. The 30/100 page-size defaults, owner/deleted filtering, all sorts and counts must not change.

- [ ] **Step 1 — Extend integration coverage if needed:** Review `largeCollectionPageReturnsOnlyThirtyBoundedPreviewsAndFullDetailRemainsAvailable`. If existing tests do not cover dense hard-break input through HTTP, add a compact fixture of two or three owned dense Notes and one foreign Note; assert HTTP list previews are nonnull, ordered and <=16,384 serialized UTF-8 bytes, no full rich content, correct owner-scoped counts; assert detail returns untruncated original JSON.
- [ ] **Step 2 — Focused verification:** Run `cd server && ./mvnw -Duser.timezone=UTC -Dtest=NotePreviewBuilderTest,NoteControllerIntegrationTest,NoteQueryServiceIntegrationTest test`. Require zero failures. If any HTTP test requires Docker/Testcontainers, run in the same supported environment as prior PR CI.
- [ ] **Step 3 — Full build:** Run `cd server && ./mvnw spotless:apply` only if formatting requires it; then `./mvnw -Duser.timezone=UTC verify`. Confirm Spotless, Error Prone, SpotBugs, JaCoCo/report and all tests. Report concrete blockers rather than claiming green without execution.
- [ ] **Step 4 — Ship the focused change on PR #84:** Commit any new HTTP test separately if modified. Push to `feature/69-notes-core-api`, verify the updated GitHub Actions/SonarCloud checks, and add a short PR comment with the commit(s), test commands/results, input sizes, before/after benchmark observations and confirmation that prior CodeRabbit findings remain resolved. **Do not merge PR #84**; request final human review.

## Acceptance / completion criteria

- [ ] The original O(k × candidate-size) repeated trimming/revalidation algorithm is gone; byte budget is enforced *during* prefix construction.
- [ ] A valid near-10k-node Note yields a meaningful <=16-KiB preview without promoting later content, with no substantial nonlinear growth in the benchmark.
- [ ] Nested Tiptap structure, marks/attrs, grapheme safety and all three preview limits are unchanged.
- [ ] No unrelated source/schema/API changes, no new dependencies; #69's owner isolation, versioning, idempotency, collections and counts still pass.
- [ ] Focused and full Maven verification pass (or exact blockers reported); CI evidence is linked.
- [ ] Luna posts implementation/benchmark evidence on PR #84, leaving the final merge decision to the human.

## Luna handoff

Start on the current PR head, read this entire plan and its linked #69 design, then use **superpowers:executing-plans inline with no subagents**. Work only on `feature/69-notes-core-api` (or a worktree of that branch), test first and make a small focused implementation commit. Do **not** reopen the earlier remediation scope, add preview persistence or merge automatically.
