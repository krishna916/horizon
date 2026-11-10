import { describe, expect, it } from 'vitest';
import { hasMeaningfulNoteDraft, normalizeNoteDraft, noteDraftsEqual } from './noteDraft';
import type { NoteDraft } from './noteDraft';

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('Note draft semantics', () => {
  it('treats blank and Java-whitespace-only title and body as empty', () => {
    expect(hasMeaningfulNoteDraft({ title: ' \t\u00a0\u2007', content: null, tags: [] })).toBe(false);
    expect(
      hasMeaningfulNoteDraft({
        title: '',
        content: { type: 'doc', content: [paragraph('\t\u00a0\u2007\u202f')] },
        tags: [],
      })
    ).toBe(false);
  });

  it('treats title-only and meaningful body-only drafts as content', () => {
    expect(hasMeaningfulNoteDraft({ title: ' A note ', content: null, tags: [] })).toBe(true);
    expect(
      hasMeaningfulNoteDraft({
        title: '',
        content: { type: 'doc', content: [paragraph('Write something')] },
        tags: [],
      })
    ).toBe(true);
  });

  it('treats tables and horizontal rules as meaningful body content', () => {
    expect(
      hasMeaningfulNoteDraft({ title: '', content: { type: 'doc', content: [{ type: 'table' }] }, tags: [] })
    ).toBe(true);
    expect(
      hasMeaningfulNoteDraft({
        title: '',
        content: { type: 'doc', content: [{ type: 'horizontalRule' }] },
        tags: [],
      })
    ).toBe(true);
  });

  it('normalizes whitespace title and empty rich text without adding display fallbacks', () => {
    expect(
      normalizeNoteDraft({
        title: '\u00a0\t  ',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        tags: [],
      })
    ).toEqual({ title: null, content: null, tags: [] });
    expect(normalizeNoteDraft({ title: '', content: null, tags: [] })).toEqual({
      title: null,
      content: null,
      tags: [],
    });
  });

  it('keeps a nullable title and compares normalized document content', () => {
    const bodyOnly: NoteDraft = {
      title: '',
      content: { type: 'doc', content: [paragraph('Body')] },
      tags: [],
    };
    expect(normalizeNoteDraft(bodyOnly)).toEqual({ title: null, content: bodyOnly.content, tags: [] });
    expect(noteDraftsEqual(bodyOnly, { title: ' \t', content: bodyOnly.content, tags: [] })).toBe(true);
  });

  it('compares tags as an unordered, case-insensitive set while keeping IDs distinct from names', () => {
    const ids = [{ id: 2 }, { id: 1 }];
    expect(noteDraftsEqual(
      { title: '', content: null, tags: ids },
      { title: '', content: null, tags: [{ id: 1 }, { id: 2 }, { id: 2 }] }
    )).toBe(true);
    expect(noteDraftsEqual(
      { title: '', content: null, tags: [{ name: ' Urgent ' }] },
      { title: '', content: null, tags: [{ name: 'urgent' }] }
    )).toBe(true);
    expect(noteDraftsEqual(
      { title: '', content: null, tags: [{ id: 1 }] },
      { title: '', content: null, tags: [{ name: 'urgent' }] }
    )).toBe(false);
  });

  it('does not create a note for tag-only drafts and includes tags in normalized requests', () => {
    const tagOnly: NoteDraft = { title: '', content: null, tags: [{ name: 'Planning' }] };
    expect(hasMeaningfulNoteDraft(tagOnly)).toBe(false);
    expect(normalizeNoteDraft(tagOnly)).toEqual({ title: null, content: null, tags: [{ name: 'Planning' }] });
  });
});
