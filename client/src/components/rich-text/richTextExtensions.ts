import { Link } from '@tiptap/extension-link';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { StarterKit } from '@tiptap/starter-kit';
import { mergeAttributes } from '@tiptap/core';
import type { Extensions } from '@tiptap/react';
import { isSafeRichTextHref } from './richTextDocument';
import { createMarkdownPasteExtension } from './markdownPaste';

export function getRichTextExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      strike: false,
      underline: false,
    }),
    Link.extend({
      renderHTML({ HTMLAttributes }) {
        const mergedAttributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes);
        const hasNofollow =
          typeof HTMLAttributes.rel === 'string' &&
          HTMLAttributes.rel.split(/\s+/).includes('nofollow');

        return [
          'a',
          {
            ...mergedAttributes,
            href: isSafeRichTextHref(HTMLAttributes.href) ? HTMLAttributes.href : '',
            target: '_blank',
            rel: hasNofollow ? 'noopener noreferrer nofollow' : 'noopener noreferrer',
          },
          0,
        ];
      },
    }).configure({
      HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
      isAllowedUri: (href) => isSafeRichTextHref(href),
      protocols: ['http', 'https', 'mailto'],
    }),
    TableKit.configure({ table: { resizable: false } }),
    Markdown,
    createMarkdownPasteExtension(),
  ];
}
