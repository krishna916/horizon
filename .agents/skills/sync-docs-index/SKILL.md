---
name: sync-docs-index
description: Use when adding, renaming, or modifying any markdown documentation files in the docs/ai/ directory
---

# Sync Docs Index

## Overview

This skill keeps the AI documentation index map [INDEX.md](./../../../docs/ai/INDEX.md) synchronized with all markdown files in the `docs/ai/` directory. It automatically extracts heading titles, deep links, and abstracts, ensuring the index map remains updated for developers and AI agents.

---

## When to Use

### Triggering Conditions
* After creating a new `.md` documentation file inside `docs/ai/`.
* After modifying headings (`#` or `##`) in any document under `docs/ai/`.
* After updating the `Purpose:` metadata block or description of any document under `docs/ai/`.
* After deleting or renaming a document under `docs/ai/`.

---

## Execution: Rebuilding the Index Map

To rebuild the index map, execute the Node.js indexer script from the repository root:

```bash
node .agents/skills/sync-docs-index/scripts/sync-index.mjs
```

The script will automatically parse all markdown files, slugify heading targets, extract document abstracts, and regenerate the central [INDEX.md](./../../../docs/ai/INDEX.md) file.

---

## Common Mistakes

* **Manual Editing**: Modifying `docs/ai/INDEX.md` by hand. The file is auto-generated; any manual edits will be overwritten the next time the sync script runs.
* **Skipping Sync**: Leaving the index map outdated after modifying H2 headings in a document, which causes broken deep links for other agents.
