import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { isSupportedRichTextDocument } from './richTextDocument';

const headingPattern = /^#{1,3}\s+\S/m;
const listPattern = /^\s{0,6}(?:[-*+]\s+\S|\d+[.)]\s+\S)/m;
const quotePattern = /^\s{0,3}>\s+\S/m;
const fencedCodePattern = /^\s{0,3}```[^\n]*\n[\s\S]*?^\s{0,3}```\s*$/m;
const linkPattern = /\[[^\]\n]+\]\([^\s)]+(?:\s+"[^"]*")?\)/;
const boldPattern = /\*\*[^*\n]+\*\*|__[^_\n]+__/;
const italicPattern = /\*(?!\s)[^*\n]+(?<!\s)\*|_(?!\s)[^_\n]+(?<!\s)_/;
const horizontalRulePattern = /^\s{0,3}(?:---+|___+|\*\*\*+)\s*$/m;

export function looksLikeMarkdown(text: string): boolean {
  const source = text.replace(/\r\n?/g, '\n').trim();
  if (source.length === 0) return false;

  const lines = source.split('\n');
  const table =
    lines.length >= 2 &&
    lines.some((line) => line.includes('|')) &&
    lines.some((line) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line));

  return (
    headingPattern.test(source) ||
    listPattern.test(source) ||
    quotePattern.test(source) ||
    fencedCodePattern.test(source) ||
    linkPattern.test(source) ||
    boldPattern.test(source) ||
    italicPattern.test(source) ||
    horizontalRulePattern.test(source) ||
    table
  );
}

export function createMarkdownPasteExtension() {
  return Extension.create({
    name: 'taskMarkdownPaste',

    addProseMirrorPlugins() {
      const { editor } = this;
      return [
        new Plugin({
          props: {
            handlePaste: (_view, event) => {
              const clipboard = event.clipboardData;
              if (clipboard?.getData('text/html').trim()) return false;

              const text = clipboard?.getData('text/plain') ?? '';
              if (!looksLikeMarkdown(text) || !editor.markdown) return false;

              try {
                const parsed = editor.markdown.parse(text);
                if (!isSupportedRichTextDocument(parsed)) return false;
                return editor.commands.insertContent(parsed);
              } catch {
                return false;
              }
            },
          },
        }),
      ];
    },
  });
}
