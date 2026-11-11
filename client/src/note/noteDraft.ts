import {
  normalizeRichTextDocument,
  richTextDocumentsEqual,
  type RichTextDocument,
} from '@/components/rich-text/richTextDocument';
import type { CreateNoteRequest } from './types';
import type { NoteDetail } from './types';
import type { TagSelection } from '@/tag/types';
import type { Tag } from '@/tag/types';

export interface NoteDraft {
  title: string;
  content: RichTextDocument | null;
  tags?: TagSelection[];
}

function isJavaWhitespace(codePoint: string): boolean {
  const value = codePoint.codePointAt(0);
  return (
    /^\p{White_Space}$/u.test(codePoint) || (value !== undefined && value >= 0x1c && value <= 0x1f)
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
  const tags: TagSelection[] = [];
  const seen = new Set<string>();
  for (const selection of draft.tags ?? []) {
    if ('id' in selection) {
      const key = `id:${selection.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        tags.push({ id: selection.id });
      }
    } else {
      const name = selection.name.trim();
      const key = `name:${name.toLowerCase()}`;
      if (name && !seen.has(key)) {
        seen.add(key);
        tags.push({ name });
      }
    }
  }
  return {
    title: normalizeTitle(draft.title),
    content: normalizeRichTextDocument(draft.content),
    tags,
  };
}

export function hasMeaningfulNoteDraft(draft: NoteDraft): boolean {
  const normalized = normalizeNoteDraft(draft);
  return normalized.title !== null || containsMeaningfulText(normalized.content);
}

export function noteDraftsEqual(first: NoteDraft, second: NoteDraft): boolean {
  const a = normalizeNoteDraft(first);
  const b = normalizeNoteDraft(second);
  return (
    a.title === b.title &&
    richTextDocumentsEqual(a.content, b.content) &&
    tagSelectionSet(a.tags) === tagSelectionSet(b.tags)
  );
}

export function reconcileNoteDraftTags(
  draft: NoteDraft,
  acknowledgedTags: TagSelection[],
  canonicalTags: Tag[]
): NoteDraft {
  const canonicalIds = new Set(canonicalTags.map((tag) => tag.id));
  const acknowledgedIds = new Map<string, number>();

  for (const selection of acknowledgedTags) {
    if ('id' in selection) {
      if (canonicalIds.has(selection.id))
        acknowledgedIds.set(tagSelectionKey(selection), selection.id);
      continue;
    }

    const name = selection.name.trim().toLowerCase();
    const matches = canonicalTags.filter((tag) => tag.name.trim().toLowerCase() === name);
    if (name && matches.length === 1) {
      acknowledgedIds.set(tagSelectionKey(selection), matches[0]!.id);
    }
  }

  const reconciledTags: TagSelection[] = [];
  const seen = new Set<string>();
  for (const selection of draft.tags ?? []) {
    const acknowledgedId = acknowledgedIds.get(tagSelectionKey(selection));
    const reconciled = acknowledgedId === undefined ? selection : { id: acknowledgedId };
    const key = tagSelectionKey(reconciled);
    if (!seen.has(key)) {
      seen.add(key);
      reconciledTags.push(reconciled);
    }
  }
  return { ...draft, tags: reconciledTags };
}

export function noteDraftMatchesNote(draft: NoteDraft, note: NoteDetail): boolean {
  const reconciled = reconcileNoteDraftTags(draft, draft.tags ?? [], note.tags);
  return noteDraftsEqual(reconciled, {
    title: note.title ?? '',
    content: note.content,
    tags: note.tags.map(({ id }) => ({ id })),
  });
}

function tagSelectionSet(tags: TagSelection[]): string {
  return [
    ...new Set(
      tags.map((tag) => ('id' in tag ? `id:${tag.id}` : `name:${tag.name.trim().toLowerCase()}`))
    ),
  ]
    .sort((left, right) => left.localeCompare(right, 'en'))
    .join('\u0000');
}

function tagSelectionKey(selection: TagSelection): string {
  return 'id' in selection ? `id:${selection.id}` : `name:${selection.name.trim().toLowerCase()}`;
}
