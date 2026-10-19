export function toTaskDescriptionDocument(text: string): Record<string, unknown> | null {
  if (text.trim().length === 0) {
    return null;
  }

  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n');
  return {
    type: 'doc',
    content: paragraphs.map((paragraph) => ({
      type: 'paragraph',
      content: paragraph.length > 0 ? [{ type: 'text', text: paragraph }] : [],
    })),
  };
}
