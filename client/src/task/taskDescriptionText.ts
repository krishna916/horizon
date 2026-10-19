const blockTypes = new Set([
  'blockquote',
  'bulletList',
  'codeBlock',
  'heading',
  'listItem',
  'orderedList',
  'paragraph',
]);

export function getTaskDescriptionText(document: Record<string, unknown> | null): string | null {
  if (document?.type !== 'doc' || !Array.isArray(document.content)) {
    return null;
  }

  let text = '';

  function append(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(append);
      return;
    }
    if (typeof value !== 'object' || value === null) {
      return;
    }

    const node = value as Record<string, unknown>;
    if (node.type === 'text') {
      if (typeof node.text === 'string') {
        text += node.text;
      }
      return;
    }
    if (node.type === 'hardBreak') {
      text += '\n';
      return;
    }

    const isBlock = typeof node.type === 'string' && blockTypes.has(node.type);
    if (isBlock && text.length > 0 && !text.endsWith('\n')) {
      text += '\n';
    }
    append(node.content);
    if (isBlock && text.length > 0 && !text.endsWith('\n')) {
      text += '\n';
    }
  }

  append(document.content);
  const normalized = text.replace(/\n{2,}/g, '\n').trim();
  return normalized.length > 0 ? normalized : null;
}
