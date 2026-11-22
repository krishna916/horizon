# Issue #75 — Source-document reconciliation package (review only)

**Status: All four amendment proposals approved for wording by the user on 2026-11-22; none has yet been applied to the authoritative knowledge repository.**

Prepared 2026-11-22 on the existing File ADR review branch `docs/75-file-architecture-adr-draft`. The four **actual project source files were inspected**; the application GitHub repository does **not** contain the authoritative versions of these PRDs or Constitution. This directory therefore supplies review-ready, section-anchored **replacement text**, rather than competing copies of the originals.

## Review-ready amendments

| Authoritative source | Proposed wording | Narrow conflict resolved |
| --- | --- | --- |
| PRD-005 Notes | [Notes proposal](PRD-005-Notes-REPLACEMENTS.md) | Optional title, tag-only drafts, Notes-first upload, Cards/List, direct editor, Active/Archived, V1 files/images and confirmed removal |
| PRD-000 Horizon V1 Scope | [V1 scope proposal](PRD-000-V1-Scope-REPLACEMENTS.md) | Notes-specific direct editor and bounded V1 files/images, while preserving V1 exclusions |
| PRD-009 Navigation | [Navigation proposal](PRD-009-Navigation-REPLACEMENTS.md) | FR-008/009/010 and workspace diagram exception: Notes directly to full-page; Tasks retain side panels |
| HORIZON_CONSTITUTION | [Constitution proposal](HORIZON-CONSTITUTION-REPLACEMENTS.md) | Note/File module boundary, File UUID exception, technical recovery state, narrow File ADR GitHub exception |

## Approved basis

- [#68 Notes UX](https://github.com/krishna916/horizon/issues/68) and [Notes design baseline](../../../design/notes-workspace/DESIGN-SPEC.md) — Cards/List browsing, optional title, direct full-page editor, meaningful creation, local tag staging.
- [#55 storage handoff](https://github.com/krishna916/horizon/issues/55), [#75 approved architecture + selected post-POC recovery](https://github.com/krishna916/horizon/issues/75) — files/images included in Notes V1, Note/File ownership split, upload and cleanup invariants.
- [Draft File ADR](../../adr/ADR-DRAFT-shared-file-object-storage.md) and [permanent S3 POC evidence](../../validation/ISSUE-75-SEAWEEDFS-S3-POC-REPORT.md) — technical contract/evidence, not a substitute for the product PRD.
- The uploaded PRD-008 Trash contract confirms restore of an archived Note from Trash to **Archived**, not Active.

## Inspected source fingerprints (SHA-256)

| Source | SHA-256 |
| --- | --- |
| `PRD-005 Notes.md` | `c24b1adc473f25cd252ae5f7f5820c8a468227d1562aa6df60052eefa1ff59e0` |
| `PRD 000 Horizon V1 Scope.md` | `a52c8815411fb9c2508edafb2578bdab1b5398584ea2428825ed8b18f94af9b5` |
| `PRD-009 Navigation.md` | `721043c4c2124347e0464da066931437a18c5505a0776214f9b92b5bf1a080ef` |
| `HORIZON_CONSTITUTION.md` | `2e70915a929d69165dc89d5e47e56725888a26be5854c8a4fd5b658289dc83c5` |

These identify the supplied source snapshots. Recheck the current knowledge-repository version **before applying any replacements**.

## Application and approval sequence

- [x] Inspect actual four project source documents and approved design/architecture references.
- [x] Prepare four proposed, section-specific amendments on ADR PR #93's branch.
- [x] **User approved the four proposed amendments** (2026-11-22); this accepts the wording, not an unverified source revision or a change to the authoritative documents.
- [ ] **Apply the approved amendments in the authoritative knowledge repository** after confirming the latest source versions and write access. The connected personal Drive search found no matching authoritative documents; do not misrepresent the uploaded snapshots or this GitHub review package as applied source edits. Update version/date/change log and link the accepted File ADR.
- [ ] After source approval, reconcile application-level context mirrors such as `docs/ai/HORIZON_PRODUCT_CONTEXT.md` through the normal documentation workflow.
- [ ] Confirm ADR numbering/status and explicitly accept/merge [ADR PR #93](https://github.com/krishna916/horizon/pull/93).
- [ ] Close issue #75 only after its final acceptance gates are met.

**Non-changes:** No Task navigation/IDs, Search scope or ownership, Trash lifecycle, other PRDs, general documentation precedence, production source, File ADR acceptance, or GitHub merge is authorized by creating this proposal package.
