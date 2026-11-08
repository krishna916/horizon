/* Issue 68: disposable, local-only design prototype. No Notes API or real uploads. */
"use strict";
const $ = (s, root = document) => root.querySelector(s);
const main = $("#main");
const modal = $("#modal");
const paths = {
  plus: "M12 5v14M5 12h14",
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z",
  inbox: "M4 4h16l2 12v4H2v-4ZM2 15h6l2 3h4l2-3h6",
  "check-circle": "M22 11a10 10 0 1 1-6-8M9 11l3 3L22 4",
  "file-text": "M14 2H5v20h14V7ZM14 2v6h5M8 12h8M8 16h6",
  settings:
    "m9 3-1 3-3 1v4l-2 1 2 3v3l3 1 1 2h6l1-2 3-1v-3l2-3-2-1V7l-3-1-1-3Zm0 9a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
  "log-out": "M9 4H4v16h5M14 8l4 4-4 4M8 12h13",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M10 21h4",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M9 9a3 3 0 1 1 5 2c-2 1-2 1-2 3M12 17h.01",
  grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  archive: "M3 3h18v5H3ZM5 8v13h14V8M10 12h4",
  trash: "M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  "arrow-left": "m12 5-7 7 7 7M5 12h15",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  check: "m5 12 4 4L19 6",
  image: "M3 3h18v18H3ZM3 16l6-6 5 5 3-3 4 4M16 7h.01",
  paperclip:
    "m21 11-8 8a6 6 0 0 1-8-8l9-9a4 4 0 0 1 6 6l-9 9a2 2 0 0 1-3-3l8-8",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  x: "m6 6 12 12M6 18 18 6",
  alert: "m12 3 10 18H2ZM12 9v4M12 17h.01",
  retry: "M3 10a9 9 0 1 1 1 7M3 3v7h7",
  tag: "M3 3h8l10 10-8 8L3 11ZM7 7h.01",
  link: "m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M14 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
  code: "m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18",
  quote: "M4 5h6v8H5c0 3 1 4 4 5M14 5h6v8h-5c0 3 1 4 4 5",
  table: "M3 3h18v18H3ZM3 9h18M9 3v18",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm7 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
  clock: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 6v6l4 2",
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths["file-text"]}"/></svg>`;
const escape = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const text = (html) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  d.querySelectorAll("figure").forEach((el) => el.remove());
  d.querySelectorAll("p,h1,h2,h3,li,td,th,pre,blockquote").forEach((el) =>
    el.append(document.createTextNode(" ")),
  );
  return d.textContent.replace(/\s+/g, " ").trim();
};
function icons(root = document) {
  root
    .querySelectorAll("[data-icon]")
    .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
}
function preference(key, fallback) {
  try {
    return (
      localStorage.getItem(`horizon.notes-mockup.demo-user.${key}`) || fallback
    );
  } catch {
    return fallback;
  }
}
function storePreference(key, value) {
  try {
    localStorage.setItem(`horizon.notes-mockup.demo-user.${key}`, value);
  } catch {
    toast("Preference unavailable. Your selection works for this visit.");
  }
}
let mode = preference("view", "cards");
if (!["cards", "list"].includes(mode)) mode = "cards";
let theme = preference("theme", "dark");
document.documentElement.dataset.theme = theme;
function themeLabel() {
  $("#theme").textContent = theme === "dark" ? "Light theme" : "Dark theme";
}
themeLabel();
icons();
const photo = "assets/kyoto-garden.png";
const imageBlock = (id = "img-garden") =>
  `<figure contenteditable="false" data-image="${id}" tabindex="0" aria-label="Inline image: Kyoto garden"><img src="${photo}" alt="Red maple branches above a still pond and stone path in a Kyoto garden"><figcaption>Garden reference · illustrative image</figcaption><div class="image-controls"><button data-preview-image="${id}" aria-label="Preview inline image">${icon("eye")}</button><button data-remove-image="${id}" aria-label="Remove inline image">${icon("trash")}</button></div></figure>`;
const fixtures = {
  pdf: {
    name: "Kyoto weekend itinerary.pdf",
    type: "PDF",
    size: "44 KB",
    path: "assets/kyoto-itinerary.pdf",
    kind: "pdf",
  },
  md: {
    name: "Travel research.md",
    type: "Markdown",
    size: "1 KB",
    path: "assets/travel-research.md",
    kind: "md",
  },
  mermaid: {
    name: "Capture to reference.mmd",
    type: "Mermaid",
    size: "1 KB",
    path: "assets/note-flow.mmd",
    kind: "mermaid",
  },
  csv: {
    name: "Packing list.csv",
    type: "CSV",
    size: "1 KB",
    path: "assets/packing-list.csv",
    kind: "download",
  },
  image: {
    name: "Kyoto garden.png",
    type: "PNG",
    size: "3.8 MB",
    path: photo,
    kind: "image",
  },
};
let fileSequence = 1;
const file = (key, status = "ready") => ({
  ...fixtures[key],
  id: `file-${fileSequence++}`,
  status,
  progress: status === "ready" ? 100 : 0,
});
function seed() {
  return [
    {
      id: 101,
      title: "A quiet weekend in Kyoto",
      tags: ["travel", "personal"],
      updated: 8,
      body: `<p>Less rushing, more wandering. Keep the plan loose enough to follow a side street.</p><h2>A few places to linger</h2>${imageBlock()}<p>Start with a garden before the city gets busy. Leave the afternoon open for a slow walk along the river.</p><ul><li>One garden, early in the morning</li><li>Coffee and a book near the Kamo River</li><li>A small dinner reservation, nothing elaborate</li></ul><h2>Good to remember</h2><p>The best part of the trip might be the space between the places. Keep the itinerary as a reference, not a checklist.</p>`,
      files: [file("pdf"), file("md"), file("mermaid"), file("csv")],
    },
    {
      id: 102,
      title: "",
      tags: ["personal"],
      updated: 7,
      body: "<p>A useful question for the end of the week:</p><blockquote>What felt important while I was doing it?</blockquote><p>Make more room for that.</p>",
      files: [],
    },
    {
      id: 103,
      title: "Designing for a clear head",
      tags: ["design"],
      updated: 6,
      body:
        "<p>A workspace earns trust when it makes the next step obvious without asking for attention.</p><h2>Notes from the review</h2><p>Start with the content. Let typography and spacing do the work before adding another control. The interface should be predictable enough that it disappears while you are thinking.</p><p>Visible structure helps when it reflects the way a person reads: a beginning, a few useful sections, and enough room to pause. Metadata can wait until it answers a question. Keep a record of the decisions so the next review starts with context rather than a blank page.</p><p>This image belongs later in the document. It must never become a cover simply because a card would look more visual with it.</p>" +
        imageBlock("img-late"),
      files: [],
    },
    {
      id: 104,
      title: "",
      tags: ["travel"],
      updated: 5,
      body: imageBlock("img-first") + "<p>Remember this pace.</p>",
      files: [],
    },
    {
      id: 105,
      title: "A small reading list",
      tags: ["reading"],
      updated: 4,
      body: "<p>Books to return to when I need a different way of seeing.</p><ul><li><strong>Four Thousand Weeks</strong> — Oliver Burkeman</li><li><strong>The Creative Act</strong> — Rick Rubin</li><li><strong>A Philosophy of Walking</strong> — Frédéric Gros</li></ul>",
      files: [],
    },
    {
      id: 106,
      title: "",
      tags: [],
      updated: 3,
      body: "",
      files: [file("csv"), file("pdf")],
    },
    {
      id: 107,
      title: "An idea to come back to",
      tags: [],
      updated: 2,
      body: "",
      files: [],
    },
    {
      id: 108,
      title: "Working notes · query patterns",
      tags: ["engineering"],
      updated: 1,
      body: "<p>Prefer the smallest query that explains the data.</p><table><thead><tr><th>Question</th><th>Approach</th></tr></thead><tbody><tr><td>Who owns this?</td><td>Filter by owner</td></tr><tr><td>What changed?</td><td>Updated timestamp</td></tr></tbody></table><pre>SELECT title, updated_at\nFROM note\nORDER BY updated_at DESC;</pre>",
      files: [],
    },
    {
      id: 201,
      title: "Summer travel references",
      tags: ["travel"],
      updated: 0,
      archived: true,
      body:
        "<p>Saved for another season. There is no need to turn every possibility into a plan.</p>" +
        imageBlock("img-archived"),
      files: [file("pdf")],
    },
  ];
}
let notes = seed(),
  selected = null,
  draft = null,
  nextId = 301,
  currentRoute = "#/notes";
let collection = "active",
  sort = "updated",
  tagFilter = "",
  scenario = "workspace",
  origin = { scroll: 0, collection: "active", sort: "updated", tag: "" };
let saveTimer,
  savePhase = "saved",
  failNextSave = false,
  dirty = false,
  pendingRemoval = null,
  waitingNavigation = null,
  uploadTimers = new Set(),
  sessionExpired = false;
const titleOf = (n) => n.title.trim() || "Untitled note";
const currentNote = () =>
  selected ? notes.find((n) => n.id === selected) : draft;
const readyFiles = (n) => n.files.filter((f) => f.status === "ready");
function toast(message, undo) {
  const t = $("#toast");
  t.replaceChildren(document.createTextNode(message));
  if (undo) {
    const b = document.createElement("button");
    b.textContent = "Undo";
    b.onclick = () => {
      undo();
      t.hidden = true;
    };
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 6500);
}
function showModal(html, cls = "") {
  modal.className = cls;
  modal.innerHTML = html;
  modal.showModal();
}
function closeModal() {
  modal.close();
}
function tagsHTML(tags, max = 2) {
  return (
    tags
      .slice(0, max)
      .map((t) => `<span class="tag">${escape(t)}</span>`)
      .join("") +
    (tags.length > max ? `<span class="tag">+${tags.length - max}</span>` : "")
  );
}
function preview(n) {
  const source = document.createElement("div");
  source.innerHTML = n.body;
  const out = document.createElement("div");
  let count = 0,
    blocks = 0,
    truncated = false;
  for (const child of source.children) {
    if (count >= 520 || blocks >= 6) {
      truncated = true;
      break;
    }
    let clone = child.cloneNode(true);
    clone
      .querySelectorAll(".image-controls,figcaption")
      .forEach((el) => el.remove());
    const flattenLink = (a) => {
      const span = document.createElement("span");
      span.append(...a.childNodes);
      a.replaceWith(span);
      return span;
    };
    clone.querySelectorAll("a").forEach(flattenLink);
    if (clone.matches("a")) clone = flattenLink(clone);
    clone.removeAttribute("tabindex");
    clone.removeAttribute("aria-label");
    clone.removeAttribute("contenteditable");
    const length = clone.textContent.length;
    if (length > 520 - count) {
      clone.textContent = clone.textContent.slice(0, 520 - count) + "…";
      truncated = true;
    }
    out.append(clone);
    count += length;
    blocks++;
  }
  return { html: out.innerHTML, truncated: truncated || n.body.length > 1100 };
}
function card(n) {
  const p = preview(n);
  const images = (n.body.match(/data-image=/g) || []).length;
  return `<a class="note-card" href="#/notes/${n.id}" aria-label="Open ${escape(titleOf(n))}" data-note-id="${n.id}"><div class="card-content"><h2 class="card-title ${!n.title ? "untitled" : ""}">${escape(titleOf(n))}</h2>${p.html ? `<div class="card-preview ${p.truncated ? "truncated" : ""}" aria-hidden="true">${p.html}</div>` : ""}</div><div class="card-footer">${n.tags.length ? `<div class="tags">${tagsHTML(n.tags)}</div>` : ""}<div class="card-meta">${readyFiles(n).length ? `<span class="file-count">${icon("paperclip")}${readyFiles(n).length} files</span>` : ""}${images ? `<span class="file-count" aria-label="${images} inline images">${icon("image")}${images}</span>` : ""}<time>Nov ${8 - Math.min(6, 8 - n.updated)}</time></div></div></a>`;
}
function row(n) {
  return `<a class="note-row" href="#/notes/${n.id}" aria-label="Open ${escape(titleOf(n))}"><div class="row-copy"><div class="row-title">${icon(n.body.includes("data-image=") ? "image" : "file-text")}<span class="${!n.title ? "untitled" : ""}">${escape(titleOf(n))}</span></div><p class="row-excerpt">${escape(text(n.body) || (n.files.length ? "Attached files" : "No content yet"))}</p></div><div class="tags">${tagsHTML(n.tags)}</div><span class="row-files">${n.files.length ? icon("paperclip") + n.files.length : "—"}</span><time class="row-time">Nov ${8 - Math.min(6, 8 - n.updated)}</time></a>`;
}
function workspace() {
  selected = null;
  draft = null;
  dirty = false;
  pendingRemoval = null;
  sessionExpired = false;
  const active = notes.filter((n) => !n.trashed && !n.archived),
    archived = notes.filter((n) => !n.trashed && n.archived);
  let items = (collection === "active" ? active : archived).filter(
    (n) => !tagFilter || n.tags.includes(tagFilter),
  );
  if (scenario === "empty") items = [];
  items.sort(
    sort === "title"
      ? (a, b) => titleOf(a).localeCompare(titleOf(b))
      : sort === "oldest"
        ? (a, b) => a.updated - b.updated
        : (a, b) => b.updated - a.updated,
  );
  main.innerHTML = `<div class="workspace"><div class="intro"><div><h1>${collection === "active" ? "All Notes" : "Archived Notes"}</h1><p>${collection === "active" ? "A place for what you want to keep." : "Out of the way. Here when you need them."}</p></div><a href="#/notes/new" class="button primary">${icon("plus")}New Note</a></div><div class="workspace-controls"><div class="tabs" aria-label="Note collection"><button class="tab" data-collection="active" aria-pressed="${collection === "active"}">Active<span class="count">${scenario === "empty" ? 0 : active.length}</span></button><button class="tab" data-collection="archived" aria-pressed="${collection === "archived"}">Archived<span class="count">${archived.length}</span></button></div><div class="filter tags-filter"><label for="tags-filter">Tags</label><select id="tags-filter"><option value="">All tags</option>${["travel", "personal", "design", "reading", "engineering"].map((t) => `<option ${tagFilter === t ? "selected" : ""}>${t}</option>`).join("")}</select></div><div class="filter"><label class="sr-only" for="sort">Sort notes</label><select id="sort"><option value="updated">Last updated</option><option value="oldest" ${sort === "oldest" ? "selected" : ""}>Oldest updated</option><option value="title" ${sort === "title" ? "selected" : ""}>Title A–Z</option></select></div><div class="mode-toggle" aria-label="Browsing mode"><button data-mode="cards" aria-label="Card View" aria-pressed="${mode === "cards"}">${icon("grid")}<span>Cards</span></button><button data-mode="list" aria-label="List View" aria-pressed="${mode === "list"}">${icon("list")}<span>List</span></button></div></div><section id="collection" aria-label="${collection === "active" ? "Active" : "Archived"} notes"></section></div>`;
  const content = $("#collection");
  if (scenario === "loading")
    content.innerHTML = `<div class="notes-grid" role="status" aria-label="Loading notes">${Array.from({ length: 6 }, () => '<div class="skeleton-card" aria-hidden="true"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>').join("")}</div><p class="collection-footer">Loading your notes…</p>`;
  else if (scenario === "error")
    content.innerHTML = emptyHTML(
      "alert",
      "Your notes couldn’t load",
      "Your saved notes are safe. Try again in a moment.",
      "Try again",
      "retry-workspace",
    );
  else if (!items.length)
    content.innerHTML = emptyHTML(
      "file-text",
      tagFilter
        ? "No notes with this tag"
        : collection === "archived"
          ? "No archived notes"
          : "Room for a thought",
      tagFilter
        ? "Choose another tag to see more notes."
        : collection === "archived"
          ? "Notes you archive will stay here, with their files."
          : "Keep an idea, a useful reference, or a few words for later.",
      tagFilter
        ? "Clear tag filter"
        : collection === "archived"
          ? "Back to active notes"
          : "Create your first note",
      tagFilter
        ? "clear-filter"
        : collection === "archived"
          ? "active-notes"
          : "new-note",
    );
  else
    content.innerHTML =
      (mode === "cards"
        ? `<div class="notes-grid">${items.map(card).join("")}</div>`
        : `<div class="list-labels"><span>Note</span><span>Tags</span><span>Files</span><span>Updated</span></div><div class="notes-list">${items.map(row).join("")}</div>`) +
      `<p class="collection-footer">${items.length} ${collection === "archived" ? "archived " : ""}notes · ${mode === "cards" ? "Previews follow the beginning of each document" : "Same notes, a little more compact"}</p>`;
  $('[data-action="retry-workspace"]')?.addEventListener("click", () => {
    scenario = "workspace";
    $("#scene").value = "workspace";
    workspace();
  });
  $('[data-action="clear-filter"]')?.addEventListener("click", () => {
    tagFilter = "";
    workspace();
  });
  $('[data-action="active-notes"]')?.addEventListener("click", () => {
    collection = "active";
    workspace();
  });
  $('[data-action="new-note"]')?.addEventListener("click", () =>
    go("#/notes/new"),
  );
  main.querySelectorAll("[data-mode]").forEach(
    (b) =>
      (b.onclick = () => {
        mode = b.dataset.mode;
        storePreference("view", mode);
        workspace();
      }),
  );
  main.querySelectorAll("[data-collection]").forEach(
    (b) =>
      (b.onclick = () => {
        collection = b.dataset.collection;
        workspace();
      }),
  );
  $("#sort").value = sort;
  $("#sort").onchange = (e) => {
    sort = e.target.value;
    workspace();
  };
  $("#tags-filter").onchange = (e) => {
    tagFilter = e.target.value;
    workspace();
  };
}
function emptyHTML(symbol, heading, copy, label, action) {
  return `<div class="empty-state"><div class="empty-icon">${icon(symbol)}</div><h2>${heading}</h2><p>${copy}</p><button class="button primary" data-action="${action}">${label}</button></div>`;
}
function renderEditor(n, isNew = false) {
  savePhase = isNew ? "draft" : "saved";
  dirty = false;
  pendingRemoval = null;
  main.innerHTML = `<div class="editor-top"><button class="back-button" id="back-notes">${icon("arrow-left")}<span>All notes</span></button><span class="separator">/</span><span class="editor-breadcrumb">${escape(isNew ? "New note" : titleOf(n))}</span><span class="save-state" id="save-state" role="status" aria-live="polite"></span><div class="editor-actions"><button class="button" id="archive-note" ${isNew ? "disabled" : ""}>${icon(n.archived ? "retry" : "archive")}${n.archived ? "Restore" : "Archive"}</button><button class="icon-button" id="more-note" popovertarget="note-menu" aria-label="More note actions">${icon("more")}</button></div><div class="action-menu" id="note-menu" popover><button id="menu-archive" ${isNew ? "disabled" : ""}>${icon(n.archived ? "retry" : "archive")}${n.archived ? "Restore to active" : "Archive note"}</button><button id="trash-note" class="danger" ${isNew ? "disabled" : ""}>${icon("trash")}Move to Trash</button><small>Archive and Trash keep attached files.</small></div></div><article class="document" aria-label="Note document">${n.archived ? `<div class="archived-notice">${icon("archive")}<span>This note is archived. You can still edit it.</span><button id="restore-inline">Restore</button></div>` : ""}<div id="save-notice" class="save-notice" role="alert" hidden></div><label for="note-title" class="sr-only">Note title (optional)</label><textarea id="note-title" class="document-title" rows="1" placeholder="Untitled note">${escape(n.title)}</textarea><div class="document-meta"><div class="tags" id="note-tags">${tagsHTML(n.tags, 20)}</div><button class="add-tag" id="add-tag">${icon("plus")}Add tags</button><time>${isNew ? "Not created yet" : "Edited Nov 8, 2026"}</time></div><div class="formatting" role="toolbar" aria-label="Text formatting"><label for="block-format" class="sr-only">Paragraph style</label><select id="block-format"><option value="p">Text</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="pre">Code block</option></select><span class="format-divider"></span><button data-command="bold" aria-label="Bold" title="Bold (Ctrl/Cmd+B)"><strong>B</strong></button><button data-command="italic" aria-label="Italic" title="Italic (Ctrl/Cmd+I)"><em>I</em></button><button id="insert-link" aria-label="Insert link" title="Insert link">${icon("link")}</button><span class="format-divider"></span><button data-command="insertUnorderedList" aria-label="Bulleted list" title="Bulleted list">${icon("list")}</button><button data-command="insertOrderedList" aria-label="Numbered list" title="Numbered list">1.</button><button data-block="blockquote" aria-label="Quote" title="Quote">${icon("quote")}</button><button id="insert-table" aria-label="Insert table" title="Insert table">${icon("table")}</button><span class="format-divider"></span><button id="insert-image" class="labelled" aria-label="Insert inline image">${icon("image")}<span>Image</span></button><button id="toolbar-attach" class="labelled" aria-label="Attach files">${icon("paperclip")}<span>File</span></button></div><div id="note-body" class="rich-body" contenteditable="true" role="textbox" aria-label="Note content" aria-multiline="true" data-placeholder="Start writing, or add an image or a file…">${n.body}</div><p class="draft-hint" id="draft-hint" ${isNew ? "" : "hidden"}>Nothing is created until you add something. Titles are optional.</p><section class="file-section" aria-label="Attached files"><div class="section-heading"><h2>${icon("paperclip")}Files <span class="count" id="file-count"></span></h2><button class="button" id="attach-files">${icon("plus")}Attach files</button></div><p>Under 20 MB per file · Images, PDF, Office, text, Markdown & Mermaid</p><div id="file-list"></div><div class="upload-drop" id="drop-target">Drop files here, or use Attach files</div></section></article>`;
  const body = $("#note-body"),
    title = $("#note-title");
  $("#back-notes").onclick = () => go("#/notes");
  $("#archive-note").onclick = () => changeArchive();
  $("#menu-archive").onclick = () => changeArchive();
  $("#restore-inline")?.addEventListener("click", () => changeArchive());
  $("#trash-note").onclick = () => trashNote();
  title.oninput = () => {
    title.style.height = "auto";
    title.style.height = title.scrollHeight + "px";
    captureEdit();
  };
  title.style.height = title.scrollHeight + "px";
  body.oninput = () => captureEdit();
  body.addEventListener("paste", (e) => {
    e.preventDefault();
    if (e.clipboardData.files.length) {
      insertImageFlow();
    } else
      document.execCommand(
        "insertText",
        false,
        e.clipboardData.getData("text/plain"),
      );
  });
  body.addEventListener("keydown", (e) => {
    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      body.querySelector("figure")
    ) {
      const sel = window.getSelection();
      const figure = e.target.closest("figure");
      let affected = figure;
      if (!affected && sel?.rangeCount) {
        const r = sel.getRangeAt(0);
        affected = [...body.querySelectorAll("figure")].find((f) =>
          r.intersectsNode(f),
        );
        if (!affected && r.collapsed) {
          const adjacent =
            e.key === "Backspace"
              ? r.startContainer.childNodes[r.startOffset - 1]
              : r.startContainer.childNodes[r.startOffset];
          affected = adjacent?.matches?.("figure") ? adjacent : null;
        }
      }
      if (affected) {
        e.preventDefault();
        removeImage(affected.dataset.image);
      }
    }
  });
  body.addEventListener("beforeinput", (e) => {
    if (e.inputType?.startsWith("history") && body.querySelector("figure")) {
      e.preventDefault();
      toast("Use the confirmed Remove control for images in this mockup.");
      return;
    }
    if (
      (e.inputType?.startsWith("delete") ||
        e.inputType?.startsWith("insert")) &&
      !window.getSelection()?.isCollapsed &&
      body.querySelector("figure")
    ) {
      const sel = window.getSelection();
      if (
        sel.rangeCount &&
        [...body.querySelectorAll("figure")].some((f) =>
          sel.getRangeAt(0).intersectsNode(f),
        )
      ) {
        e.preventDefault();
        toast("Remove each image with its Remove control, then edit the text.");
      }
    }
  });
  body.addEventListener("cut", (e) => {
    const selection = window.getSelection();
    const figure =
      selection?.rangeCount &&
      [...body.querySelectorAll("figure")].find((f) =>
        selection.getRangeAt(0).intersectsNode(f),
      );
    if (figure) {
      e.preventDefault();
      removeImage(figure.dataset.image);
    }
  });
  body.addEventListener("dragstart", (e) => {
    if (e.target.closest("figure")) {
      e.preventDefault();
      toast("Use the confirmed Remove control to remove an image.");
    }
  });
  body.onclick = (e) => {
    const remove = e.target.closest("[data-remove-image]");
    if (remove) removeImage(remove.dataset.removeImage);
    const view = e.target.closest("[data-preview-image]");
    if (view)
      previewFile({
        ...fixtures.image,
        id: view.dataset.previewImage,
        status: "ready",
      });
    const retry = e.target.closest("[data-retry-inline]");
    if (retry)
      startInlineUpload(
        retry.closest("[data-inline-upload]"),
        retry.dataset.retryInline,
        false,
      );
  };
  main.querySelectorAll("[data-command]").forEach((b) => {
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => {
      body.focus();
      document.execCommand(b.dataset.command, false);
      captureEdit();
    };
  });
  main.querySelectorAll("[data-block]").forEach((b) => {
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => {
      body.focus();
      document.execCommand("formatBlock", false, b.dataset.block);
      captureEdit();
    };
  });
  $("#block-format").onchange = (e) => {
    body.focus();
    document.execCommand("formatBlock", false, e.target.value);
    captureEdit();
  };
  $("#insert-link").onclick = () => linkDialog();
  $("#insert-table").onmousedown = (e) => e.preventDefault();
  $("#insert-table").onclick = () => {
    body.focus();
    document.execCommand(
      "insertHTML",
      false,
      "<table><tbody><tr><th>Column 1</th><th>Column 2</th></tr><tr><td>Write here</td><td>Write here</td></tr></tbody></table><p><br></p>",
    );
    captureEdit();
  };
  $("#insert-image").onclick = () => insertImageFlow();
  $("#attach-files").onclick = $("#toolbar-attach").onclick = () =>
    uploadDialog();
  $("#add-tag").onclick = () => tagDialog();
  const drop = $("#drop-target");
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add("dragover");
  };
  drop.ondragleave = () => drop.classList.remove("dragover");
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove("dragover");
    if (e.dataTransfer.files.length) handleLocalFiles(e.dataTransfer.files);
    else uploadDialog();
  };
  body.ondragover = (e) => e.preventDefault();
  body.ondrop = (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (files.some((f) => /^image\//.test(f.type) && f.size < 20000000))
      insertImageFlow();
    const rest = files.filter((f) => !/^image\//.test(f.type));
    if (rest.length) handleLocalFiles(rest);
    if (files.some((f) => /^image\//.test(f.type) && f.size >= 20000000))
      toast("Images must be under 20 MB.");
  };
  renderFiles();
  updateSaveState();
}
function ensureCreated() {
  if (selected) return;
  const n = draft;
  n.id = nextId++;
  n.updated = 9;
  notes.unshift(n);
  selected = n.id;
  draft = null;
  history.replaceState({}, "", `#/notes/${n.id}`);
  currentRoute = location.hash;
  $("#draft-hint").hidden = true;
  $(".document-meta time").textContent = "Created just now";
  $("#archive-note").disabled =
    $("#menu-archive").disabled =
    $("#trash-note").disabled =
      false;
  savePhase = "saved";
  updateSaveState();
  toast(`Note created · /notes/${n.id} (simulated)`);
}
function captureEdit() {
  const n = currentNote();
  if (!n || sessionExpired) return;
  const title = $("#note-title").value,
    body = $("#note-body").innerHTML;
  const meaningful =
    title.trim() || text(body) || $("#note-body img") || n.files.length;
  if (!selected && !meaningful) return;
  if (!selected) ensureCreated();
  n.title = title;
  n.body = body;
  n.updated = 9;
  $(".editor-breadcrumb").textContent = titleOf(n);
  dirty = true;
  savePhase = "saving";
  updateSaveState();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(finishSave, 900);
}
function finishSave() {
  const n = currentNote();
  if (!n || sessionExpired) return;
  if (failNextSave) {
    failNextSave = false;
    savePhase = "failed";
    dirty = true;
    updateSaveState();
    return;
  }
  if (pendingRemoval) {
    pendingRemoval();
    pendingRemoval = null;
  }
  dirty = false;
  savePhase = "saved";
  updateSaveState();
  renderFiles();
  if (waitingNavigation && !hasUploads()) {
    const target = waitingNavigation;
    waitingNavigation = null;
    if (modal.open) closeModal();
    navigateNow(target);
  }
}
function retrySave() {
  savePhase = "saving";
  updateSaveState();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(finishSave, 750);
}
function updateSaveState() {
  const el = $("#save-state");
  if (!el) return;
  el.classList.toggle("failed", savePhase === "failed");
  el.innerHTML =
    savePhase === "draft"
      ? "Not created yet"
      : savePhase === "saving"
        ? icon("clock") + "Saving…"
        : savePhase === "failed"
          ? icon("alert") + 'Save failed <button id="retry-save">Retry</button>'
          : icon("check") + "Saved";
  $("#retry-save")?.addEventListener("click", retrySave);
  const notice = $("#save-notice");
  notice.hidden = savePhase !== "failed";
  notice.innerHTML =
    savePhase === "failed"
      ? icon("alert") +
        "<span>Changes haven’t saved. They’re still here. Retry before leaving.</span>"
      : "";
}
function renderFiles() {
  const n = currentNote();
  if (!n || !$("#file-list")) return;
  $("#file-count").textContent = n.files.length || "";
  $("#file-list").innerHTML =
    n.files
      .map(
        (f) =>
          `<div class="file-row"><span class="file-symbol">${icon(f.kind === "image" ? "image" : "file-text")}</span><div class="file-copy"><button class="file-name" data-preview="${f.id}" ${f.status === "uploading" ? "disabled" : ""}>${escape(f.name)}</button><div class="file-detail ${f.status === "failed" ? "file-error" : ""}">${f.status === "uploading" ? `Uploading ${f.progress}% · simulated` : f.status === "failed" ? "Upload failed · Your other files are safe" : `${f.type} · ${f.size}${f.kind === "download" ? " · Download only" : ""}`}</div>${f.status === "uploading" ? `<div class="upload-progress" role="progressbar" aria-label="Uploading ${escape(f.name)}" aria-valuenow="${f.progress}" aria-valuemin="0" aria-valuemax="100"><span style="width:${f.progress}%"></span></div>` : ""}</div><div class="file-actions">${f.status === "failed" ? `<button class="retry" data-retry="${f.id}">Retry</button>` : f.status === "ready" ? `<a class="icon-button" href="${f.path}" download aria-label="Download ${escape(f.name)}">${icon("download")}</a>` : ""}${f.status !== "uploading" ? `<button class="icon-button" data-remove-file="${f.id}" aria-label="Remove ${escape(f.name)}">${icon("trash")}</button>` : ""}</div></div>`,
      )
      .join("") ||
    '<p class="muted" style="font-size:14px">No files attached.</p>';
  $("#file-list")
    .querySelectorAll("[data-preview]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const f = n.files.find((f) => f.id === b.dataset.preview);
          if (f.status === "failed") {
            toast("This file hasn’t uploaded yet. Choose Retry.");
            return;
          }
          previewFile(f);
        }),
    );
  $("#file-list")
    .querySelectorAll("[data-retry]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          startUpload(
            n.files.find((f) => f.id === b.dataset.retry),
            false,
          )),
    );
  $("#file-list")
    .querySelectorAll("[data-remove-file]")
    .forEach((b) => (b.onclick = () => removeFile(b.dataset.removeFile)));
}
function removalDialog(name, onConfirm) {
  if (dirty || pendingRemoval) {
    toast("Wait for the current change to save, or Retry a failed save.");
    return;
  }
  showModal(
    `<h2 id="modal-title">Remove this file?</h2><p><strong>${escape(name)}</strong> will be permanently removed after the updated note saves. This can’t be undone. Cancel keeps the file.</p><div class="dialog-actions"><button class="button" id="cancel-remove" autofocus>Cancel</button><button class="button danger" id="confirm-remove">Remove file</button></div>`,
  );
  $("#cancel-remove").onclick = closeModal;
  $("#confirm-remove").onclick = () => {
    closeModal();
    onConfirm();
  };
}
function removeFile(id) {
  const n = currentNote(),
    f = n.files.find((f) => f.id === id);
  removalDialog(f.name, () => {
    pendingRemoval = () => {
      n.files = n.files.filter((f) => f.id !== id);
      toast("File removed after saving (simulated).");
    };
    dirty = true;
    savePhase = "saving";
    updateSaveState();
    saveTimer = setTimeout(finishSave, 750);
  });
}
function removeImage(id) {
  const n = currentNote();
  removalDialog("Inline garden image", () => {
    pendingRemoval = () => {
      const el = $("#note-body").querySelector(`[data-image="${id}"]`);
      el?.remove();
      n.body = $("#note-body").innerHTML;
      toast("Inline image removed after saving (simulated).");
    };
    dirty = true;
    savePhase = "saving";
    updateSaveState();
    saveTimer = setTimeout(finishSave, 750);
  });
}
function uploadDialog() {
  showModal(
    `<h2 id="modal-title">Attach files</h2><p>Choose sample files to try independent uploads. No files leave your device in this prototype.</p><div class="upload-choices"><button class="button" data-upload="pdf">${icon("file-text")}PDF itinerary</button><button class="button" data-upload="md">${icon("file-text")}Markdown with a diagram</button><button class="button" data-upload="mermaid">${icon("code")}Mermaid diagram</button><button class="button" data-upload="csv">${icon("table")}CSV · download only</button><button class="button" data-upload="image">${icon("image")}Image attachment</button><button class="button primary" id="mixed-upload">${icon("paperclip")}Try 3 files · one will fail</button></div><p class="fixture-note">Approved types: JPEG, PNG, WebP, GIF, PDF, DOCX, XLSX, PPTX, TXT, MD, CSV, MMD and MERMAID. Each file must be under 20 MB.</p><div class="dialog-actions"><button class="button" id="cancel-upload">Cancel</button></div>`,
  );
  $("#cancel-upload").onclick = closeModal;
  modal.querySelectorAll("[data-upload]").forEach(
    (b) =>
      (b.onclick = () => {
        closeModal();
        addUpload(b.dataset.upload);
      }),
  );
  $("#mixed-upload").onclick = () => {
    closeModal();
    addUpload("pdf");
    addUpload("md", true);
    addUpload("csv");
  };
}
function addUpload(key, fail = false) {
  ensureCreated();
  const n = currentNote(),
    f = file(key, "uploading");
  n.files.push(f);
  renderFiles();
  startUpload(f, fail);
}
function startUpload(f, fail) {
  const n = currentNote();
  if (!n) return;
  f.status = "uploading";
  f.progress = 0;
  renderFiles();
  const interval = setInterval(() => {
    if (sessionExpired) {
      clearInterval(interval);
      uploadTimers.delete(interval);
      return;
    }
    f.progress = Math.min(100, f.progress + 20);
    if (f.progress === 100) {
      clearInterval(interval);
      uploadTimers.delete(interval);
      f.status = fail ? "failed" : "ready";
      if (!fail) {
        n.updated = 9;
        toast(`${f.name} uploaded (simulated).`);
      }
      if (selected === n.id) {
        renderFiles();
        if (waitingNavigation && !hasUploads() && !dirty) {
          closeModal();
          const target = waitingNavigation;
          waitingNavigation = null;
          navigateNow(target);
        }
      }
    } else if (selected === n.id) renderFiles();
  }, 380);
  uploadTimers.add(interval);
}
function handleLocalFiles(files) {
  for (const f of files) {
    const ext = f.name.split(".").pop().toLowerCase();
    if (f.size >= 20000000) {
      toast(`${f.name}: files must be under 20 MB.`);
      continue;
    }
    if (
      ![
        "jpg",
        "jpeg",
        "png",
        "webp",
        "gif",
        "pdf",
        "docx",
        "xlsx",
        "pptx",
        "txt",
        "md",
        "csv",
        "mmd",
        "mermaid",
      ].includes(ext)
    ) {
      toast(`${f.name}: this file type isn’t supported.`);
      continue;
    }
    addUpload(
      ["jpg", "jpeg", "png", "webp", "gif"].includes(ext)
        ? "image"
        : ext === "pdf"
          ? "pdf"
          : ext === "md"
            ? "md"
            : ["mmd", "mermaid"].includes(ext)
              ? "mermaid"
              : "csv",
    );
    toast(
      "Drop accepted. A sample fixture represents your file; no bytes are uploaded.",
    );
  }
}
function insertImageFlow() {
  const body = $("#note-body"),
    selection = window.getSelection();
  const range =
    selection?.rangeCount && body.contains(selection.anchorNode)
      ? selection.getRangeAt(0).cloneRange()
      : null;
  showModal(
    `<h2 id="modal-title">Insert an inline image</h2><p>Try the sample garden photograph. It will appear at your cursor, within the document.</p><img src="${photo}" alt="Sample Kyoto garden photograph" style="width:100%;border-radius:6px"><p class="fixture-note">Image paste and drop use the same Note-first flow. Image bytes are simulated here.</p><div class="dialog-actions"><button class="button" id="cancel-image">Cancel</button><button class="button" id="fail-image">Simulate upload failure</button><button class="button primary" id="confirm-image">Insert image</button></div>`,
  );
  const insert = (fail) => {
    closeModal();
    ensureCreated();
    const id = "img-" + Date.now(),
      marker = document.createElement("div");
    marker.className = "inline-upload";
    marker.dataset.inlineUpload = id;
    marker.contentEditable = "false";
    if (range) {
      range.insertNode(marker);
    } else body.append(marker);
    captureEdit();
    startInlineUpload(marker, id, fail);
  };
  $("#cancel-image").onclick = closeModal;
  $("#confirm-image").onclick = () => insert(false);
  $("#fail-image").onclick = () => insert(true);
}
function startInlineUpload(marker, id, fail) {
  let progress = 0;
  marker.dataset.uploadState = "uploading";
  marker.innerHTML = `${icon("image")}<span>Uploading image… 0% · simulated</span>`;
  const timer = setInterval(() => {
    if (sessionExpired || !marker.isConnected) {
      clearInterval(timer);
      uploadTimers.delete(timer);
      return;
    }
    progress += 20;
    marker.innerHTML = `${icon("image")}<span>Uploading image… ${progress}% · simulated</span>`;
    if (progress < 100) return;
    clearInterval(timer);
    uploadTimers.delete(timer);
    if (fail) {
      marker.dataset.uploadState = "failed";
      marker.innerHTML = `${icon("alert")}<span>Image upload failed. Your text is saved.</span><button class="button" data-retry-inline="${id}">Retry image upload</button>`;
    } else marker.outerHTML = imageBlock(id);
    captureEdit();
  }, 380);
  uploadTimers.add(timer);
}
function tagDialog() {
  const n = currentNote();
  const all = [
    ...new Set([
      "travel",
      "personal",
      "design",
      "reading",
      "engineering",
      ...n.tags,
    ]),
  ];
  showModal(
    `<h2 id="modal-title">Tags</h2><p>Choose labels that help you find this note again.</p><div class="tag-options">${all.map((t) => `<button class="tag-option" aria-pressed="${n.tags.includes(t)}" data-tag="${escape(t)}">${escape(t)}</button>`).join("")}</div><label class="dialog-label" for="new-tag">Add another tag</label><input id="new-tag" type="text" placeholder="Tag name" maxlength="100"><div class="dialog-actions"><button class="button" id="cancel-tags">Cancel</button><button class="button primary" id="apply-tags">Apply tags</button></div>`,
  );
  const chosen = new Set(n.tags);
  modal.querySelectorAll("[data-tag]").forEach(
    (b) =>
      (b.onclick = () => {
        chosen.has(b.dataset.tag)
          ? chosen.delete(b.dataset.tag)
          : chosen.add(b.dataset.tag);
        b.setAttribute("aria-pressed", chosen.has(b.dataset.tag));
      }),
  );
  $("#cancel-tags").onclick = closeModal;
  $("#apply-tags").onclick = () => {
    const value = $("#new-tag").value.trim();
    if (
      value &&
      !Array.from(chosen).some((t) => t.toLowerCase() === value.toLowerCase())
    )
      chosen.add(value);
    const next = [...chosen];
    if (JSON.stringify(next) !== JSON.stringify(n.tags)) {
      n.tags = next;
      ensureCreated();
      $("#note-tags").innerHTML = tagsHTML(n.tags, 20);
      captureEdit();
    }
    closeModal();
  };
}
function linkDialog() {
  const body = $("#note-body"),
    s = window.getSelection(),
    range =
      s?.rangeCount && body.contains(s.anchorNode)
        ? s.getRangeAt(0).cloneRange()
        : null;
  showModal(
    '<h2 id="modal-title">Insert link</h2><label class="dialog-label" for="link-url">Web address</label><input id="link-url" type="url" placeholder="https://example.com"><p id="link-error" hidden class="file-error">Use an https:// or http:// address.</p><div class="dialog-actions"><button class="button" id="cancel-link">Cancel</button><button class="button primary" id="apply-link">Insert link</button></div>',
  );
  $("#cancel-link").onclick = closeModal;
  $("#apply-link").onclick = () => {
    const value = $("#link-url").value.trim();
    if (!/^https?:\/\//i.test(value)) {
      $("#link-error").hidden = false;
      return;
    }
    closeModal();
    body.focus();
    if (range) {
      s.removeAllRanges();
      s.addRange(range);
    }
    document.execCommand(
      "insertHTML",
      false,
      `<a href="${escape(value)}" target="_blank" rel="noopener noreferrer">${escape(range?.toString() || value)}</a>`,
    );
    captureEdit();
  };
}
function diagramHTML() {
  return `<svg class="diagram" viewBox="0 0 640 145" role="img" aria-label="Capture leads to Inbox, review leads to active reference"><g fill="none" stroke="currentColor" stroke-width="1.3"><rect x="10" y="40" width="130" height="58" rx="7"/><path d="M140 69h45m-7-5 7 5-7 5"/><rect x="185" y="40" width="115" height="58" rx="7"/><path d="M300 69h45m-7-5 7 5-7 5"/><rect x="345" y="40" width="115" height="58" rx="7"/><path d="M460 69h45m-7-5 7 5-7 5"/><rect x="505" y="40" width="125" height="58" rx="7"/></g><g fill="currentColor" text-anchor="middle" font-family="system-ui,sans-serif" font-size="15"><text x="75" y="75">Capture</text><text x="242" y="75">Inbox</text><text x="402" y="75">Review</text><text x="567" y="75">Reference</text></g></svg>`;
}
function previewFile(f, failed = false, pdfFallback = false) {
  const content = failed
    ? `<div class="viewer-error">${icon("alert")}<h2>Preview couldn’t load</h2><p>The original file is still attached. Try again, or download it to open on your device.</p><button class="button" id="retry-preview">${icon("retry")}Retry preview</button></div>`
    : f.kind === "image"
      ? `<img src="${f.path}" alt="Kyoto garden photograph">`
      : f.kind === "pdf"
        ? pdfFallback
          ? '<p class="pdf-help">Sample page fallback for design review. Production uses the browser-native PDF viewer.</p><img src="assets/kyoto-itinerary-preview.png" alt="Rendered sample PDF itinerary with Saturday, Sunday and reminder sections">'
          : `<p class="pdf-help">PDF uses your browser’s viewer. If it stays blank, choose Show sample page below.</p><iframe title="PDF preview: Kyoto itinerary" src="${f.path}"></iframe>`
        : f.kind === "md"
          ? `<article><h1 style="font-size:27px">Travel research</h1><p>A loose plan for a slower weekend.</p><h2>Start with a little space</h2><ul><li>Visit a garden before the city gets busy.</li><li>Keep one afternoon free.</li><li>Save references without turning them into tasks.</li></ul><h2>From capture to reference</h2>${diagramHTML()}<p>Read-only preview · Download the original to edit.</p></article>`
          : f.kind === "mermaid"
            ? `<article><h2>Capture to reference</h2>${diagramHTML()}<p>Read-only Mermaid preview</p></article>`
            : `<div class="viewer-error">${icon("download")}<h2>Download to open</h2><p>${f.type} files can be downloaded and opened on your device. An in-app preview isn’t available.</p></div>`;
  showModal(
    `<div class="dialog-heading"><h2 id="modal-title">${escape(f.name)}</h2><button class="icon-button" id="close-preview" aria-label="Close file preview">${icon("x")}</button></div><div class="viewer-meta">${f.type} · ${f.size} · ${f.kind === "download" ? "Download only" : "Read-only preview"}</div><div class="viewer-content">${content}</div><div class="dialog-actions">${!failed && f.kind === "pdf" ? `<button class="button" id="pdf-fallback">${pdfFallback ? "Try native PDF viewer" : "Show sample page"}</button>` : ""}${!failed && f.kind !== "download" ? '<button class="button" id="fail-preview">Simulate preview failure</button>' : ""}<a class="button primary" href="${f.path}" download>${icon("download")}Download original</a></div>`,
    "viewer",
  );
  $("#close-preview").onclick = closeModal;
  $("#pdf-fallback")?.addEventListener("click", () => {
    closeModal();
    previewFile(f, false, !pdfFallback);
  });
  $("#retry-preview")?.addEventListener("click", () => {
    closeModal();
    previewFile(f);
  });
  $("#fail-preview")?.addEventListener("click", () => {
    closeModal();
    previewFile(f, true);
  });
}
function hasUploads() {
  return (
    uploadTimers.size > 0 ||
    currentNote()?.files.some((f) => f.status === "uploading")
  );
}
function go(target) {
  if (target === currentRoute) return;
  if (currentNote() && (dirty || hasUploads() || sessionExpired)) {
    navigationGuard(target);
    return;
  }
  navigateNow(target);
}
function navigateNow(target) {
  if (location.hash === target) {
    route(target);
    return;
  }
  location.hash = target;
}
function navigationGuard(target) {
  showModal(
    `<h2 id="modal-title">${sessionExpired ? "Your session changed" : hasUploads() ? "Files are still uploading" : savePhase === "failed" ? "Changes haven’t saved" : "Saving your changes"}</h2><p>${sessionExpired ? "This editor is hidden until you sign in again. Changes from this session won’t be carried into another account." : "Keep this note open while saving finishes. Leaving now would discard unsaved changes or interrupt uploads."}</p><div class="dialog-actions"><button class="button" id="keep-editing" autofocus>${sessionExpired ? "Stay here" : "Keep editing"}</button><button class="button primary" id="save-leave">${sessionExpired ? "Simulate sign in again" : "Retry / wait & leave"}</button></div><p class="fixture-note">This prototype keeps edits in memory only. Reload resets sample content.</p>`,
  );
  $("#keep-editing").onclick = () => {
    waitingNavigation = null;
    closeModal();
  };
  $("#save-leave").onclick = () => {
    if (sessionExpired) {
      closeModal();
      sessionExpired = false;
      selected = null;
      draft = null;
      dirty = false;
      waitingNavigation = null;
      notes = seed();
      navigateNow("#/notes");
      toast("New demo session. Previous editor state cleared.");
      return;
    }
    waitingNavigation = target;
    if (dirty) retrySave();
    if (!hasUploads() && !dirty) {
      closeModal();
      navigateNow(target);
    } else $("#save-leave").textContent = "Waiting for changes…";
  };
}
function changeArchive() {
  const n = currentNote();
  if (dirty || hasUploads()) {
    toast("Finish saving and uploading before changing this note.");
    return;
  }
  n.archived = !n.archived;
  const state = n.archived ? "archived" : "restored";
  renderEditor(n);
  toast(`Note ${state}. Attached files are kept.`);
}
function trashNote() {
  const n = currentNote();
  if (dirty || hasUploads()) {
    toast("Finish saving and uploading before moving this note.");
    return;
  }
  n.trashed = true;
  selected = null;
  dirty = false;
  document.querySelector("[popover]:popover-open")?.hidePopover();
  navigateNow("#/notes");
  toast("Note moved to Trash. Its files are kept.", () => {
    n.trashed = false;
    workspace();
  });
}
function route(hash = location.hash || "#/notes") {
  if (modal.open) closeModal();
  if (currentRoute === "#/notes" && hash !== "#/notes")
    origin = { scroll: main.scrollTop, collection, sort, tag: tagFilter };
  currentRoute = hash;
  main.scrollTop = 0;
  const match = /^#\/notes\/(\d+)$/.exec(hash);
  if (hash === "#/notes/new") {
    selected = null;
    draft = { id: null, title: "", body: "", tags: [], files: [] };
    renderEditor(draft, true);
    $("#note-title").focus();
  } else if (match) {
    const n = notes.find((n) => n.id === Number(match[1]) && !n.trashed);
    if (n) {
      selected = n.id;
      draft = null;
      renderEditor(n);
    } else missingNote();
  } else {
    collection = origin.collection;
    sort = origin.sort;
    tagFilter = origin.tag;
    workspace();
    requestAnimationFrame(() => (main.scrollTop = origin.scroll));
  }
}
function missingNote() {
  selected = null;
  draft = null;
  dirty = false;
  main.innerHTML = emptyHTML(
    "file-text",
    "This note isn’t available",
    "It may have been removed, or it may belong to another account.",
    "Back to notes",
    "back-workspace",
  );
  $('[data-action="back-workspace"]').onclick = () => go("#/notes");
}
window.addEventListener("hashchange", () => {
  const target = location.hash || "#/notes";
  if (
    currentNote() &&
    (dirty || hasUploads() || sessionExpired) &&
    target !== currentRoute
  ) {
    history.replaceState({}, "", currentRoute);
    navigationGuard(target);
    return;
  }
  route(target);
});
document.addEventListener("click", (e) => {
  if (e.target.closest('a[href="#main"]')) {
    e.preventDefault();
    main.focus();
    return;
  }
  const a = e.target.closest('a[href^="#/notes"]');
  if (a) {
    e.preventDefault();
    go(a.getAttribute("href"));
  }
});
window.addEventListener("beforeunload", (e) => {
  if (dirty || hasUploads()) {
    e.preventDefault();
    e.returnValue = "";
  }
});
modal.addEventListener("cancel", () => (waitingNavigation = null));
$("#theme").onclick = () => {
  theme = theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  storePreference("theme", theme);
  themeLabel();
};
function cancelPending() {
  clearTimeout(saveTimer);
  for (const timer of uploadTimers) {
    clearInterval(timer);
    clearTimeout(timer);
  }
  uploadTimers.clear();
  pendingRemoval = null;
  dirty = false;
  waitingNavigation = null;
  failNextSave = false;
}
$("#reset").onclick = () => {
  cancelPending();
  notes = seed();
  selected = null;
  draft = null;
  mode = "cards";
  storePreference("view", mode);
  collection = "active";
  sort = "updated";
  tagFilter = "";
  scenario = "workspace";
  origin = { scroll: 0, collection: "active", sort: "updated", tag: "" };
  $("#scene").value = "workspace";
  history.replaceState({}, "", "#/notes");
  currentRoute = "#/notes";
  workspace();
  toast("Sample notes reset. First-use Card View restored.");
};
$("#scene").onchange = (e) => {
  const scene = e.target.value;
  if (scene === "arm-failure") {
    failNextSave = true;
    toast("The next simulated save will fail.");
    return;
  }
  cancelPending();
  scenario = scene;
  selected = null;
  draft = null;
  if (["workspace", "empty", "loading", "error"].includes(scene)) {
    origin = { scroll: 0, collection: "active", sort: "updated", tag: "" };
    collection = "active";
    sort = "updated";
    tagFilter = "";
    history.replaceState({}, "", "#/notes");
    currentRoute = "#/notes";
    workspace();
    return;
  }
  if (scene === "missing") {
    history.replaceState({}, "", "#/notes/999");
    currentRoute = location.hash;
    missingNote();
    return;
  }
  history.replaceState({}, "", "#/notes/101");
  currentRoute = location.hash;
  selected = 101;
  const n = notes.find((n) => n.id === 101);
  n.trashed = false;
  renderEditor(n);
  main.scrollTop = 0;
  if (scene === "save-error") {
    failNextSave = true;
    $("#note-title").value = n.title + " · working draft";
    captureEdit();
    finishSave();
    clearTimeout(saveTimer);
  }
  if (scene === "upload") {
    addUpload("pdf");
    addUpload("md", true);
    addUpload("csv");
    $("#file-list").scrollIntoView({ block: "center" });
  }
  if (scene === "preview-error") previewFile(n.files[0], true);
  if (scene === "session") {
    sessionExpired = true;
    main.innerHTML = emptyHTML(
      "file-text",
      "Your session changed",
      "Sign in again before opening your notes.",
      "Simulate sign in again",
      "sign-in-again",
    );
    $('[data-action="sign-in-again"]').onclick = () =>
      navigationGuard("#/notes");
    navigationGuard("#/notes");
  }
};
if (!location.hash) history.replaceState({}, "", "#/notes");
route();
