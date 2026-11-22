# Proposed authoritative amendment — PRD-000 Horizon V1 Scope

**Status:** WORDING APPROVED by user on 2026-11-22. Not applied to the authoritative knowledge repository or accepted as a new V1 scope version.

**Baseline inspected:** `10-Product/V1/PRD 000 Horizon V1 Scope.md`, “Horizon V1 Scope Document v1 (Draft)”; SHA-256 `a52c8815411fb9c2508edafb2578bdab1b5398584ea2428825ed8b18f94af9b5`. Check knowledge-repository revision before applying.

**Approved references:** [#68 Notes UX](https://github.com/krishna916/horizon/issues/68); [design baseline](../../../design/notes-workspace/DESIGN-SPEC.md); [#55 Notes V1 File inclusion](https://github.com/krishna916/horizon/issues/55); [#75 File architecture](https://github.com/krishna916/horizon/issues/75); [proposed File ADR](../../adr/ADR-DRAFT-shared-file-object-storage.md).

The V1 scope's overall Action Management + Information Management vision and **Tasks, Home, Today, Inbox, Tag, Archive, Trash and Search** boundaries remain unchanged.

## 1. `7 Domain Workspaces → Notes` — replace that subsection only

Current baseline says Notes are independent information and support rich text/autosave, but does not specify the Notes-specific navigation, optional title, V1 file scope, or creation rules.

**Proposed replacement:**

> ### Notes
>
> Notes manage **independent information** (research, meetings, travel, architecture decisions), not a PKM system.
>
> - **Browse:** an Active or Archived Notes collection displayed as Cards or compact List. First use defaults to Cards; last selection is remembered **locally per user/browser/device**. This preference is not a saved view or cross-device setting.
> - **Open:** any Note card/row or New Note opens the **direct full-page editor**. This is an intentional Notes-only exception to the Tasks panel-first interaction.
> - **Author:** rich-text document editing, optional title with **UI-only** `Untitled note` fallback, tags, formatting, unobtrusive autosave and save-failure retry. Meaningful title/body/inline image/regular attachment can create a Note. An untouched new editor or tag-only draft remains unpersisted; staged tags join the first meaningful create.
> - **Images and files:** V1 includes **inline images and regular attachments** (as approved in #55/#68). The Note is persisted **before** a first-file upload; failed first upload retains the Note for retry. Inline images remain at actual document positions, including eligible card previews. Files are private and accessible only through authenticated owner-authorized backend routes.
> - **Use and removal:** individual upload/retry states are independent; preview approved image/PDF/Markdown/Mermaid formats in a file-only modal and allow original download. Individual file/image deletion requires explicit confirmation and successful Note save; Archive and Trash retain file associations. Permanent parent deletion uses future Global Trash cleanup.
>
> Storage lifecycle, size/type validation, idempotency, keys and recovery are specified in the **File architecture ADR and File implementation stories**, not redefined in this scope document. The current **strict per-file <20 MiB** and approved format allowlist remain V1 constraints.
>
> Notes are **information storage**, not notebooks, backlinks, graph navigation, collaboration or generalized file management.

## 2. `9 Navigation Architecture → Object Navigation Pattern` — replace the shared rule

Current source:

```text
List
↓
Side Panel
↓
Full Page

Applies to:
Tasks
Notes
```

**Proposed replacement:**

> **Tasks:** preserve the existing **List → Side Panel → Full Page** contextual inspection model; no Task navigation decision changes here.
>
> **Notes:** **Cards/List → Full-page editor directly**. Opening a Note is navigation to its canonical page, not a side-panel inspection. New Note starts in the full-page editor. File attachment preview modals are for file bytes only, not a Notes side panel.
>
> **Both workspaces:** preserve direct URLs, browser history, origin/context on return, and existing owner/lifecycle authorization. Canonical routes remain `/tasks/{id}` and `/notes/{id}`. An ephemeral Notes draft may use `/notes/new` until its first meaningful persistence.
>
> The side panel remains the primary **Task contextual-inspection** surface; it is **not** a global requirement for Notes. Full Page is not a second product capability.

Keep `Primary Navigation`, `Global Capabilities`, `Routing`, and other workspace navigation unchanged.

## 3. `3 V1 Non-Goals` / `11 V1 Boundaries` — annotate, don't reverse

Do **not** delete existing exclusions (Knowledge Graph, Version History, Saved Views, Persistent Filters, Tag Management, Automation, Analytics, etc.).

Add a clarification in `11:

> Notes V1's already-approved inline images and regular attachments are **bounded content features** supporting information storage; they do not imply a new independent Files workspace, public file sharing, collaborative document platform, attachment content indexing, full PKM, saved views, or generalized rich-media authoring.

The user/device Cards/List preference does **not** introduce persisted cross-device view preferences or saved filters. The V1 File module remains shared technical infrastructure, not a new sidebar workspace or user-facing global capability.

## 4. `12 Deferred Features` — distinguish new Notes V1 from later media

Within `Knowledge Management`, keep backlinks, PKM, graph and version-history deferrals unchanged. Add:

> Further file/media capabilities beyond the approved Notes V1 attachments/inline images—independent file library, cross-note sharing, Office conversion/editing, resumable uploads, image editing and attachment content search—remain deferred.

**Do not** change the existing Search product goal or title/body Search scope; #74 / Stage 07 owns delivery timing.

## 5. Applied-document bookkeeping (after approval only)

Add a narrow revision note referencing #68, #55, #75 and accepted File ADR. Keep overall V1 vision and non-goals untouched. This proposal neither merges the File ADR nor authorizes implementation or knowledge-repository changes.

### Minimal cross-document consistency checks

- `PRD-005` is authoritative for Note behavior and file UX details.
- `PRD-009` owns the Notes-only direct-page navigation exception.
- `HORIZON_CONSTITUTION` records the corresponding **high-level** exception and File module identity/governance; detailed browser interactions stay in PRD-005.
- `PRD-008 Trash` still restores prior archived state; never simplify Archived → Trash → Restore to Active.
