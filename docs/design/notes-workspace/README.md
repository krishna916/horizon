# Notes workspace design review

Interactive local mockup for [issue 68](https://github.com/krishna916/horizon/issues/68). **Proposed baseline; final UX approval pending.** This is design work only. No production Notes/API/storage code was changed.

```sh
python3 -m http.server 5185 --bind 127.0.0.1 --directory docs/design/notes-workspace
```

Open [the mockup](http://localhost:5185/) or [the screenshot gallery](http://localhost:5185/gallery.html).

- [Design specification and decision register](DESIGN-SPEC.md)
- [Browser verification and limitations](VERIFICATION.md)
- [Reviewer handoff draft](REVIEW-HANDOFF.md)
- [Asset provenance](assets/ASSETS.md)

Try Cards/List, a note and Back, New Note without editing, then a body-only edit. In the editor, use tags, formatting, Image and Files. Use the review scenario selector for failures. “Fail next save” lets you confirm that removing a file retains it until Retry succeeds. Archive and Trash keep attached files. Reset demo restores sample notes and Card View.

Content exists only in memory and resets on reload. Only view choice and review theme are stored locally, under a fictional demo-user key. Uploads and authentication are simulated. The review strip is not product UI. The existing Horizon app remains available independently on its original port.
