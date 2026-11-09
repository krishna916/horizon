import {
  normalizeRichTextDocument,
  richTextDocumentsEqual,
  type RichTextDocument,
} from '@/components/rich-text/richTextDocument';
import type { CreateNoteRequest } from './types';

export interface NoteDraft {
  title: string;
  content: RichTextDocument | null;
}

function isJavaWhitespace(codePoint: string): boolean {
  const value = codePoint.codePointAt(0);
  return (
    /^[\p{White_Space}]$/u.test(codePoint) ||
    (value !== undefined && value >= 0x1c && value <= 0x1f)
  );
}

function normalizeTitle(title: string): string | null {
  const codePoints = Array.from(title);
  let start = 0;
  let end = codePoints.length;

  while (start < end && isJavaWhitespace(codePoints[start]!)) start += 1;
  while (end > start && isJavaWhitespace(codePoints[end - 1]!)) end -= 1;

  return start === end ? null : codePoints.slice(start, end).join('');
}

function containsMeaningfulText(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsMeaningfulText);

  const node = value as Record<string, unknown>;
  if (node.type === 'table' || node.type === 'horizontalRule') return true;
  if (node.type === 'text' && typeof node.text === 'string') {
    return Array.from(node.text).some((character) => !isJavaWhitespace(character));
  }
  return containsMeaningfulText(node.content);
}

export function normalizeNoteDraft(draft: NoteDraft): CreateNoteRequest {
  return {
    title: normalizeTitle(draft.title),
    content: normalizeRichTextDocument(draft.content),
  };
}

export function hasMeaningfulNoteDraft(draft: NoteDraft): boolean {
  const normalized = normalizeNoteDraft(draft);
  return normalized.title !== null || containsMeaningfulText(normalized.content);
}

export function noteDraftsEqual(first: NoteDraft, second: NoteDraft): boolean {
  const a = normalizeNoteDraft(first);
  const b = normalizeNoteDraft(second);
  return a.title === b.title && richTextDocumentsEqual(a.content, b.content);
}
