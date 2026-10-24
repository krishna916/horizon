import { describe, expect, it } from 'vitest';
import { normalizeRichTextDocument, toEditorDocument } from './richTextDocument';

describe('normalizeRichTextDocument', () => {
  it('converts null and empty documents to null', () => {
    expect(normalizeRichTextDocument(null)).toBeNull();
    expect(normalizeRichTextDocument({ type: 'doc', content: [] })).toBeNull();
    expect(normalizeRichTextDocument({ type: 'doc', content: [{ type: 'paragraph' }] })).toBeNull();
  });

  it('converts whitespace-only text to null', () => {
    expect(
      normalizeRichTextDocument({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: ' \n\t ' }] }],
      })
    ).toBeNull();
  });

  it('preserves legacy paragraph documents and content exactly', () => {
    const legacy = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Legacy' }] }],
    };
    expect(normalizeRichTextDocument(legacy)).toEqual(legacy);
    expect(toEditorDocument(legacy)).toEqual(legacy);
  });

  it('preserves structural content in an empty table and horizontal rule', () => {
    const structural = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }],
            },
          ],
        },
        { type: 'horizontalRule' },
      ],
    };
    expect(normalizeRichTextDocument(structural)).toEqual(structural);
  });

  it('provides an empty Tiptap document for the editor when the value is null', () => {
    expect(toEditorDocument(null)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});
