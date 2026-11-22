# Proposed authoritative amendment — PRD-005 Notes v1.0

**Status:** WORDING APPROVED by user on 2026-11-22. **Not** an authoritative PRD and **not yet applied** to the knowledge repository.

**Baseline inspected:** `10-Product/V1/PRD-005 Notes.md` (supplied project source), v1.0 Draft, dated 2026-06-13; SHA-256 `c24b1adc473f25cd252ae5f7f5820c8a468227d1562aa6df60052eefa1ff59e0`. Recheck the current knowledge-repository revision before applying.

**Approved basis:** [Notes UX #68](https://github.com/krishna916/horizon/issues/68), [design specification](../../../design/notes-workspace/DESIGN-SPEC.md), [storage handoff #55](https://github.com/krishna916/horizon/issues/55), [issue #75 D-01–D-29](https://github.com/krishna916/horizon/issues/75) and [draft File ADR PR #93](../../adr/ADR-DRAFT-shared-file-object-storage.md). This document describes **proposed replacement wording**, not newly requested features. Make final edits only in the authoritative PRD after approval.

## A. `4 Responsibilities` / `5 Non-Responsibilities` — append narrowly

Add under `4 responsibilities:

> - Own a Note's rich-text document, its associations to inline images/regular attachments, the presentation role of each association, and Note-scoped authorization for file access.
> - Preserve associated files while a Note is archived or in Trash; participate in confirmed individual-file removal and eventual cleanup through the shared File API.

Add under `5 non-responsibilities:

> - Physical object bytes, S3 provider/keys, checksum/format verification, File UUID lifecycle, and cross-workspace exclusive File claim are owned by the shared File module. Notes accesses that module through `file.api`, not direct File repositories.

Do not create an independent Files workspace or make Notes a general-purpose object-storage module.

## B. `6 FR-003` — replace the required-title text

Current source requires `Title (Required)Content (Optional)`.

**Proposed full requirement:**

> A Note's title is **optional**. Its body is also optional; a Note may be valid with meaningful title, body, inline image, or regular attachment alone. Display `Untitled note` (or the accepted fallback) only in the UI when a title is absent; never persist that fallback or treat merely rendering it as a user edit.
>
> Opening an untouched new editor creates **no persisted Note**. A new editor with only selected/created Tags also remains a local draft: stage tag selections without creating a Note, Note–Tag association or new shared Tag. Discard staged tags if the user abandons that draft. On first meaningful title/body/image/file action, create the Note with staged tags through the existing Note creation contract.

This is a scoped exception to the old title requirement, **not** permission for unconditional empty Note creation.

## C. `6 FR-004 / FR-005 / FR-006` — retain foundations and append

Keep direct editing, autosave and listed rich-text formatting. Add:

> **First file action:** If selecting an attachment/inserting an image is the first meaningful change, persist the Note first using the existing idempotent create flow, then prepare/transfer the file bound to that Note. If upload fails, **keep the otherwise-empty persisted Note** so the user can retry; successful text and unrelated uploads must not be rolled back.
>
> **Autosave feedback:** Show `Saving…`, `Saved` and `Save failed` with a clear retry path. Unsaved or in-flight changes must not be silently discarded by navigation. Individual file uploads fail/retry independently of editor autosave.
>
> **Inline content:** Rich-text documents may contain approved image nodes referencing a File UUID at its actual document position. Regular attachments appear in a distinct Files section, not embedded in the rich-text preview. Preserve reading order in both editor and eligible card previews.

No specific debounce duration, toolbar component or HTTP endpoint is mandated here.

## D. `6 FR-007 / FR-008` — preserve active default, replace archived presentation

Preserve: active Notes display by default and archived Notes remain outside the active collection.

Replace the FR-008 collapsed `Archived (N) ▶` section requirement with:

> The Notes workspace has separate **Active** and **Archived** collection controls with counts. Users can switch collections; the initial/default view is Active. Archived Notes remain directly accessible, editable, searchable when Search is implemented, and restorable. Do not require a nested collapsed archive section inside Active.

This reflects the accepted #68 design baseline, not a new global archive-navigation rule.

## E. `6 FR-009 / FR-010 / FR-011 / FR-019` — append file lifecycle constraints

Preserve Archive / Restore / Delete, Trash recovery/permanent removal, archived editability and the previous lifecycle state on Trash restoration. Add:

> Archive retains Note content and attached/inline file bytes. Moving the Note to Trash retains files for later restore; ordinary Note/file routes must not expose trashed content. Restoring from Trash preserves file IDs, associations and the Note's previous Active/Archived state (e.g., Archived → Trash → Archived).
>
> Individual attachment and inline-image removals require **explicit confirmation**, including editor deletion/cut/replacement/history cases. Persist the updated document, association changes and Note version first as one valid mutation, then schedule eventual physical cleanup. If the save fails, retain the existing saved document and file. If an inline File UUID occurs multiple times in one Note, removing one occurrence does not remove the associated file; cleanup occurs only after its last reference is removed.
>
> Parent permanent deletion remains a Global Trash responsibility (Epic #9) and will invoke the shared File cleanup interface. Do not implement new Trash UI here.

## F. `6 FR-017 / FR-018` — replace both panel obligations

Current source requires Notes Side Panel and Full Page with identical capabilities.

**Proposed replacement:**

> Selecting any Note in Card or List view opens the **full-page editor directly**, as does New Note. There is **no intermediate Notes side panel**. This is a Notes-specific exception to the generic Task List → Side Panel → Full Page model.
>
> Persisted Notes have canonical route `/notes/{id}`, while an unpersisted draft may use `/notes/new`. After first meaningful persistence, transition to its canonical route without a duplicate browser-history entry or editor reset. Returning to origin restores context (browse mode, filters/sort/scroll where practical). Preserve browser Back, refresh and direct links.

Remove FR-018's Notes panel/full-page parity assertion. **Tasks remain unchanged.**

## G. `8 Information Architecture` / `12 Navigation` — targeted replacement

Replace `Notes Workspace` structural layout with:

```text
Notes Workspace
  Active / Archived collection controls with counts
  Card View / List View toggle
  Search / tag filter and sorting controls (within their own implementation scope)
  Notes collection
  New Note -> full-page editor
```

Replace `Note List Item` with:

> **Cards:** bounded, document-first preview beginning at the actual start of the Note, retaining image order/position; do not promote later images as cover art. Natural card height up to an approved visual cap; show fallback title only when needed, tags/updated date and independent file/image indicators.
>
> **List:** compact row with title or fallback, a one-line excerpt, tags, file-count indicator and updated date; no mandatory image thumbnail.
>
> Default sort remains **Updated Date DESC** (FR-016). First-use view is **Cards**; remember the last Cards/List preference on that user/browser/device only. This is not a saved view, persistent filter or cross-device account setting.

Replace `Note Detail` with:

> Full-page document-oriented editor: optional title, tags/metadata, compact formatting controls, rich-text body, separate Files section, and unobtrusive save/action status.

Replace `Navigation Model` and the incompatible `12 Navigation Rules` with:

```text
Notes Cards / List
    ↓
Full-page Note editor /notes/{id}

New Note -> /notes/new -> first meaningful persistence -> /notes/{id}
```

> Opening from Search/Inbox/direct link uses the Note's canonical page; return paths preserve the origin. A file preview **modal** is an exception only for previewing file content; it is **not** a Note inspection side panel.

Leave the canonical `/notes` and `/notes/{id}` route requirements intact; add `/notes/new` only for the ephemeral draft route.

## H. `9 Required Product Data` / `10 States & Behaviors` / `13 Edge Cases`

Replace `Note title` in required product data with `Optional Note title`; do **not** make a File UUID, storage key or S3 provider a required Note business field. Note-owned File associations identify the File UUID and presentation role. Continue to require existing created/updated/archive/delete timestamps, Inbox semantics and tags as already specified; the exact File SQL/schema is deferred to #76–#78.

Add these focused cases:

- Title-only, body-only, inline-image-only and attachment-only Notes are valid; untouched or tag-only new editor drafts are **not persisted**.
- First file upload failure leaves the persisted Note available for retry; one failed file does not invalidate another completed upload.
- Rich-text save/version conflicts cannot silently detach image associations or overwrite newer Note text.
- A confirmed image removal that fails to save leaves the association and saved document intact.
- Archive/Trash/restore retain the same associated files and original lifecycle state; individual confirmed deletion triggers eventual cleanup.
- Multiple inline references to **one fileId within the same Note** are valid, but cross-Note reuse and simultaneous inline/attachment role are not.

## I. Proposed V1 files/image addendum (placement after `FR-020`, no new FR numbers assigned yet)

> **V1 coverage:** regular attachments and inline images. Allowed upload formats: JPEG/JPG, PNG, WebP, GIF; PDF; DOCX, XLSX, PPTX; TXT, MD, CSV; Mermaid `.mmd` and `.mermaid`. Per-file size is **strictly less than 20 MiB** (maximum **20,971,519 bytes**). Reject HTML, SVG, executables and macro-enabled Office files; server verifies declared length, actual bytes and required SHA-256 per the File ADR.
>
> **Private access:** all downloads/previews are through authenticated, owner-authorized Note-scoped backend routes; no browser-direct S3 URLs, public buckets or file sharing. Original download remains available for allowed types.
>
> **Preview:** image, browser-native PDF, sanitized read-only Markdown (including Mermaid), standalone Mermaid. Office DOCX/XLSX/PPTX and TXT/CSV are **download-only in V1**. Attachment previews use a modal, not a Note preview overlay. On preview failure, allow Retry and original download.
>
> **Removal and retries:** each upload has independent progress/failure/retry. File or image removal requires explicit confirmation, successful Note/document persistence and eventual object cleanup. See the File ADR for technical prepare/transfer/finalize and UNKNOWN-upload recovery; do not duplicate its protocol here.

## J. `15 Future Considerations` / `16 Out of Scope`

Replace broad future item `Rich media support` with `Additional rich media, embeds, media editing and conversion beyond the approved V1 images/files`. Keep PKM, backlinks, templates, knowledge graph, collaboration, custom databases, folders/collections and other current exclusions unchanged.

Add to Notes V1 exclusions: independent Files workspace, cross-note file sharing, public/presigned browser S3 links, multipart/resumable uploads, attachment full-text/filename search, Office conversion/editing, public publishing, and speculative media capabilities. Do **not** change FR-014/015's **title/body Search participation**; implementation timing remains owned by #74 / Stage 07.

## K. Metadata and audit on approval

When applying to the **knowledge repository**, update `Version`, `Last Updated` and the `Change Log` for the accepted revision. Link #68, #55, #75 and the accepted File ADR; do not silently assign the next PRD version or represent the draft as already accepted.

**No change** to FR-001/002 active vs Inbox creation, FR-012/013 Tags, FR-016 Updated Date DESC, FR-019 archive editability or FR-020 editing ≠ Inbox review beyond the additions above. PRD-008 Trash's previous-lifecycle restore contract remains authoritative.
