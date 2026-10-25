import { describe, expect, it } from 'vitest';
import {
  isSupportedRichTextDocument,
  normalizeRichTextDocument,
  richTextDocumentsEqual,
  toEditorDocument,
} from './richTextDocument';

describe('richTextDocumentsEqual', () => {
  it('ignores object key insertion order while preserving nested document content', () => {
    const first = {
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
                    title: 'Docs',
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const reordered = {
      content: [
        {
          content: [
            {
              marks: [
                {
                  attrs: {
                    title: 'Docs',
                    rel: 'noopener noreferrer nofollow',
                    target: '_blank',
                    href: 'https://example.com',
                  },
                  type: 'link',
                },
              ],
              text: 'Docs',
              type: 'text',
            },
          ],
          type: 'paragraph',
        },
      ],
      type: 'doc',
    };

    expect(richTextDocumentsEqual(first, reordered)).toBe(true);
  });

  it('treats explicit Tiptap default and nullable attributes as equivalent to omitted attrs', () => {
    const withoutDefaults = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          content: [{ type: 'text', text: 'Title' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Docs',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            },
          ],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }],
            },
          ],
        },
      ],
    };
    const withDefaults = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Title' }],
        },
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
                    target: null,
                    rel: null,
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

    expect(richTextDocumentsEqual(withoutDefaults, withDefaults)).toBe(true);
  });

  it('treats link URL and text changes as semantically different', () => {
    const linkedDocument = (href: string, text: string) => ({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }],
        },
      ],
    });

    expect(
      richTextDocumentsEqual(
        linkedDocument('https://one.example', 'Docs'),
        linkedDocument('https://two.example', 'Docs')
      )
    ).toBe(false);
    expect(
      richTextDocumentsEqual(
        linkedDocument('https://one.example', 'Docs'),
        linkedDocument('https://one.example', 'Other')
      )
    ).toBe(false);
  });

  it('treats heading-level and table-content changes as semantically different', () => {
    const heading = (level: number) => ({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level }, content: [{ type: 'text', text: 'Title' }] }],
    });
    const table = (text: string) => ({
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
                  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(richTextDocumentsEqual(heading(1), heading(2))).toBe(false);
    expect(richTextDocumentsEqual(table('A'), table('B'))).toBe(false);
  });

  it('compares valid empty documents with null but keeps structural content distinct', () => {
    const empty = { type: 'doc', content: [{ type: 'paragraph' }] };
    const table = {
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
      ],
    };

    expect(richTextDocumentsEqual(null, empty)).toBe(true);
    expect(richTextDocumentsEqual(null, table)).toBe(false);
    expect(richTextDocumentsEqual({ type: 'doc', content: [{ type: 'futureWidget' }] }, null)).toBe(
      false
    );
  });
});

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
