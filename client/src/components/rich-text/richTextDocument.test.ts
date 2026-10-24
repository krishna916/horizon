import { describe, expect, it } from 'vitest';
import {
  isSupportedRichTextDocument,
  normalizeRichTextDocument,
  toEditorDocument,
} from './richTextDocument';

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

  it('rejects unsafe URLs accepted by permissive browser URL normalization', () => {
    expect(
      isSupportedRichTextDocument({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'link',
                marks: [
                  {
                    type: 'link',
                    attrs: { href: 'https://user:password@example.com' },
                  },
                ],
              },
            ],
          },
        ],
      })
    ).toBe(false);
  });

  it('accepts compatible href-only links and rejects outbound-policy overrides', () => {
    const withLink = (attrs: Record<string, unknown>) => ({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Docs', marks: [{ type: 'link', attrs }] }],
        },
      ],
    });

    expect(isSupportedRichTextDocument(withLink({ href: 'https://example.com' }))).toBe(true);
    expect(
      isSupportedRichTextDocument(
        withLink({
          href: 'https://example.com',
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
        })
      )
    ).toBe(true);
    for (const attrs of [
      { href: 'https://example.com', target: '_self', rel: 'noopener noreferrer' },
      { href: 'https://example.com', rel: 'nofollow' },
      { href: 'https://example.com', rel: 'noopener' },
    ]) {
      expect(isSupportedRichTextDocument(withLink(attrs))).toBe(false);
    }
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

  it('accepts nullable Tiptap link titles and table alignments from the pinned schema', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Docs',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.com',
                    target: '_blank',
                    rel: 'noopener noreferrer nofollow',
                    class: null,
                    title: null,
                  },
                },
              ],
            },
          ],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null },
                  content: [{ type: 'paragraph' }],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(isSupportedRichTextDocument(document)).toBe(true);
    expect(normalizeRichTextDocument(document)).toEqual(document);
    expect(
      isSupportedRichTextDocument({
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableCell',
                    attrs: { align: 'url(javascript:alert(1))' },
                    content: [{ type: 'paragraph' }],
                  },
                ],
              },
            ],
          },
        ],
      })
    ).toBe(false);
  });

  it('provides an empty Tiptap document for the editor when the value is null', () => {
    expect(toEditorDocument(null)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});
