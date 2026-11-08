# Draft reviewer handoff — issue 68 / Epic 4

Prepared locally for posting after review; this file has not been posted to GitHub.

The proposed Notes baseline is available in `docs/design/notes-workspace/`: runnable `index.html`, stylesheet/script, decision register, local assets, screenshot gallery and verification notes.

It demonstrates Cards/List → direct full-page editing; optional titles; first-meaningful-change creation; document-order previews with bounded natural heights; tags and a compact visible formatting toolbar; image/file flows; independent upload failures/Retry; file previews; confirmed removal after saving; editable archive; retained files in Trash; navigation guards and narrow layouts. No production Notes or storage code is included.

Major proposals: row-major cards capped at 440 px; Active/Archived collection buttons; centered document column; 900 ms idle save feedback; modal file previews. The compact visible toolbar was chosen during review. Other visual/interaction choices remain proposed.

The design spec records actual conflicts in the Constitution, PRD-000 and PRD-005, including required titles, Notes panel navigation, archive presentation and the formerly deferred broad media wording. It proposes amendments without altering accepted source documents.

**Please explicitly approve this visual/interaction baseline, or identify revisions, before production Notes work starts.** Approve authoritative-document amendments separately before applying them. Record the final artifact commit in issue 68 and link it from Epic 4 after sign-off. #75’s separate File ADR/S3 proof gate remains in place.
