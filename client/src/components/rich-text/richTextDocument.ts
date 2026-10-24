export type RichTextDocument = Record<string, unknown>;

const structuralNodes = new Set(['table', 'horizontalRule']);
const blockNodes = new Set([
  'blockquote',
  'bulletList',
  'codeBlock',
  'doc',
  'heading',
  'horizontalRule',
  'listItem',
  'orderedList',
  'paragraph',
  'table',
  'tableCell',
  'tableHeader',
  'tableRow',
]);
const inlineNodes = new Set(['hardBreak', 'text']);
const supportedMarks = new Set(['bold', 'italic', 'code', 'link']);
const safeProtocols = new Set(['http:', 'https:', 'mailto:']);
const safeRelTokens = new Set(['noopener', 'noreferrer', 'nofollow']);
const requiredRelTokens = new Set(['noopener', 'noreferrer']);
const defaultAttributes: Record<string, Record<string, unknown>> = {
  codeBlock: { language: null },
  heading: { level: 1 },
  link: { target: null, rel: null, class: null, title: null },
  orderedList: { start: 1, type: null },
  tableCell: { colspan: 1, rowspan: 1, colwidth: null, align: null },
  tableHeader: { colspan: 1, rowspan: 1, colwidth: null, align: null },
};

export function isSafeRichTextHref(href: unknown): href is string {
  if (
    typeof href !== 'string' ||
    href.trim() !== href ||
    Array.from(href).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  ) {
    return false;
  }

  try {
    const parsed = new URL(href);
    if (!safeProtocols.has(parsed.protocol)) return false;
    if (parsed.protocol === 'mailto:') {
      const address = href.slice('mailto:'.length);
      return address.length > 0 && !address.startsWith('//');
    }
    return (
      parsed.hostname.length > 0 && parsed.username.length === 0 && parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSupportedMark(mark: unknown): boolean {
  if (!isRecord(mark) || typeof mark.type !== 'string' || !supportedMarks.has(mark.type)) {
    return false;
  }
  if (mark.type !== 'link') return true;
  const attrs = mark.attrs;
  if (!isRecord(attrs) || !isSafeRichTextHref(attrs.href)) return false;
  if (
    !Object.keys(attrs).every((key) => ['href', 'target', 'rel', 'class', 'title'].includes(key))
  ) {
    return false;
  }
  if (attrs.target != null && attrs.target !== '_blank') return false;
  if (attrs.rel != null && !isSafeRel(attrs.rel)) return false;
  if (attrs.class != null) return false;
  return attrs.title == null || (typeof attrs.title === 'string' && attrs.title.length <= 512);
}

function isSafeRel(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  const tokens = new Set(value.trim().split(/\s+/));
  return (
    [...tokens].every((token) => safeRelTokens.has(token)) &&
    [...requiredRelTokens].every((token) => tokens.has(token))
  );
}

function isSupportedAttrs(type: string, value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;

  const perNodeAllowed: Record<string, string[]> = {
    heading: ['level'],
    orderedList: ['start', 'type'],
    codeBlock: ['language'],
    tableCell: ['colspan', 'rowspan', 'colwidth', 'align'],
    tableHeader: ['colspan', 'rowspan', 'colwidth', 'align'],
    paragraph: [],
    bulletList: [],
    listItem: [],
    blockquote: [],
    table: [],
    tableRow: [],
    hardBreak: [],
    horizontalRule: [],
  };
  const allowedKeys = perNodeAllowed[type];
  if (!allowedKeys || !Object.keys(value).every((key) => allowedKeys.includes(key))) return false;

  if (type === 'heading') {
    return (
      typeof value.level === 'number' &&
      Number.isInteger(value.level) &&
      value.level >= 1 &&
      value.level <= 3
    );
  }
  if (type === 'orderedList') {
    return (
      (value.start === undefined ||
        (typeof value.start === 'number' && Number.isInteger(value.start) && value.start > 0)) &&
      (value.type == null || ['1', 'a', 'A', 'i', 'I'].includes(String(value.type)))
    );
  }
  if (type === 'codeBlock')
    return (
      value.language == null || (typeof value.language === 'string' && value.language.length <= 100)
    );
  if (type === 'tableCell' || type === 'tableHeader') {
    const isBoundedInteger = (number: unknown) =>
      typeof number === 'number' && Number.isInteger(number) && number > 0 && number <= 100;
    return (
      (value.colspan === undefined || isBoundedInteger(value.colspan)) &&
      (value.rowspan === undefined || isBoundedInteger(value.rowspan)) &&
      (value.colwidth == null ||
        (Array.isArray(value.colwidth) && value.colwidth.every(isBoundedInteger))) &&
      (value.align == null || ['left', 'center', 'right'].includes(String(value.align)))
    );
  }
  return true;
}

function isSupportedNode(node: unknown): node is Record<string, unknown> {
  if (!isRecord(node) || typeof node.type !== 'string') return false;
  const type = node.type;
  if (type !== 'doc' && !blockNodes.has(type) && !inlineNodes.has(type)) return false;
  if (!isSupportedAttrs(type, node.attrs)) return false;

  if (type === 'text') {
    return (
      typeof node.text === 'string' &&
      (node.marks === undefined || (Array.isArray(node.marks) && node.marks.every(isSupportedMark)))
    );
  }

  if (type === 'hardBreak' || type === 'horizontalRule') return true;
  return (
    node.content === undefined ||
    (Array.isArray(node.content) && node.content.every(isSupportedNode))
  );
}

function hasMeaningfulContent(node: Record<string, unknown>): boolean {
  if (node.type === 'text') return typeof node.text === 'string' && node.text.trim().length > 0;
  if (structuralNodes.has(String(node.type))) return true;
  if (!Array.isArray(node.content)) return false;
  return node.content.some((child) => isRecord(child) && hasMeaningfulContent(child));
}

export function normalizeRichTextDocument(
  document: RichTextDocument | null
): RichTextDocument | null {
  if (
    document === null ||
    document.type !== 'doc' ||
    !Array.isArray(document.content) ||
    !isSupportedNode(document)
  ) {
    return null;
  }
  return hasMeaningfulContent(document) ? document : null;
}

function canonicalize(value: unknown, applySchemaDefaults: boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, applySchemaDefaults));
  if (!isRecord(value)) return value;

  const defaults =
    applySchemaDefaults && typeof value.type === 'string'
      ? defaultAttributes[value.type]
      : undefined;
  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const property = value[key];
    if (key === 'attrs' && isRecord(property) && defaults) {
      const entries = Object.entries(property).filter(
        ([name, attr]) => !Object.hasOwn(defaults, name) || defaults[name] !== attr
      );
      entries.sort(([first], [second]) => first.localeCompare(second));
      const attrs: Record<string, unknown> = {};
      for (const [name, attr] of entries) {
        attrs[name] = canonicalize(attr, applySchemaDefaults);
      }
      if (Object.keys(attrs).length > 0) canonical.attrs = attrs;
      continue;
    }
    canonical[key] = canonicalize(property, applySchemaDefaults);
  }
  return canonical;
}

function canonicalDocument(document: RichTextDocument | null): unknown {
  if (document === null) return null;
  if (!isSupportedRichTextDocument(document)) return canonicalize(document, false);
  const normalized = normalizeRichTextDocument(document);
  return normalized === null ? null : canonicalize(normalized, true);
}

export function richTextDocumentsEqual(
  first: RichTextDocument | null,
  second: RichTextDocument | null
): boolean {
  return JSON.stringify(canonicalDocument(first)) === JSON.stringify(canonicalDocument(second));
}

export function toEditorDocument(document: RichTextDocument | null): RichTextDocument {
  return (
    normalizeRichTextDocument(document) ?? {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    }
  );
}

export function isSupportedRichTextDocument(document: RichTextDocument | null): boolean {
  return (
    document === null ||
    (document.type === 'doc' && Array.isArray(document.content) && isSupportedNode(document))
  );
}
