import { describe, expect, it } from 'vitest';
import { hasMeaningfulNoteDraft, normalizeNoteDraft, noteDraftsEqual } from './noteDraft';
import type { NoteDraft } from './noteDraft';

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('Note draft semantics', () => {
  it('treats blank and Java-whitespace-only title and body as empty', () => {
    expect(hasMeaningfulNoteDraft({ title: ' \t\u00a0\u2007', content: null })).toBe(false);
    expect(
      hasMeaningfulNoteDraft({
        title: '',
        content: { type: 'doc', content: [paragraph('\t\u00a0\u2007\u202f')] },
      })
    ).toBe(false);
  });

  it('treats title-only and meaningful body-only drafts as content', () => {
    expect(hasMeaningfulNoteDraft({ title: ' A note ', content: null })).toBe(true);
    expect(
      hasMeaningfulNoteDraft({
        title: '',
        content: { type: 'doc', content: [paragraph('Write something')] },
      })
    ).toBe(true);
  });

  it('treats tables and horizontal rules as meaningful body content', () => {
    expect(
      hasMeaningfulNoteDraft({ title: '', content: { type: 'doc', content: [{ type: 'table' }] } })
    ).toBe(true);
    expect(
      hasMeaningfulNoteDraft({
        title: '',
        content: { type: 'doc', content: [{ type: 'horizontalRule' }] },
      })
    ).toBe(true);
  });

  it('normalizes whitespace title and empty rich text without adding display fallbacks', () => {
    expect(
      normalizeNoteDraft({
        title: '\u00a0\t  ',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
      })
    ).toEqual({ title: null, content: null });
    expect(normalizeNoteDraft({ title: '', content: null })).toEqual({
      title: null,
      content: null,
    });
  });

  it('keeps a nullable title and compares normalized document content', () => {
    const bodyOnly: NoteDraft = {
      title: '',
      content: { type: 'doc', content: [paragraph('Body')] },
    };
    expect(normalizeNoteDraft(bodyOnly)).toEqual({ title: null, content: bodyOnly.content });
    expect(noteDraftsEqual(bodyOnly, { title: ' \t', content: bodyOnly.content })).toBe(true);
  });
});
