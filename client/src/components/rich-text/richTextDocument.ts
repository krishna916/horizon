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

export function isSafeRichTextHref(href: unknown): href is string {
  if (typeof href !== 'string') return false;

  try {
    const parsed = new URL(href);
    return (
      safeProtocols.has(parsed.protocol) &&
      (parsed.protocol === 'mailto:' || parsed.hostname.length > 0)
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
  return isRecord(attrs) && isSafeRichTextHref(attrs.href);
}

function isSupportedNode(node: unknown): node is Record<string, unknown> {
  if (!isRecord(node) || typeof node.type !== 'string') return false;
  const type = node.type;
  if (type !== 'doc' && !blockNodes.has(type) && !inlineNodes.has(type)) return false;

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
