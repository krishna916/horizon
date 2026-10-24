import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { isSupportedRichTextDocument } from './richTextDocument';

const headingPattern = /^#{1,3}\s+\S/m;
const listPattern = /^\s{0,6}(?:[-*+]\s+\S|\d+[.)]\s+\S)/m;
const quotePattern = /^\s{0,3}>\s+\S/m;
const fencedCodePattern = /^\s{0,3}```[^\n]*\n[\s\S]*?^\s{0,3}```\s*$/m;
const boldPattern = /\*\*[^*\n]+\*\*|__[^_\n]+__/;
const italicPattern = /\*(?!\s)[^*\n]+(?<!\s)\*|_(?!\s)[^_\n]+(?<!\s)_/;
const horizontalRulePattern = /^\s{0,3}(?:---+|___+|\*\*\*+)\s*$/m;
const tableSeparatorCellPattern = /^:?-{3,}:?$/;

function tableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;
  const cells = trimmed.split('|');
  if (trimmed.startsWith('|')) cells.shift();
  if (trimmed.endsWith('|')) cells.pop();
  return cells.map((cell) => cell.trim());
}

function hasGfmTable(lines: string[]): boolean {
  return lines.some((line, index) => {
    const headers = tableCells(line);
    const separators = tableCells(lines[index + 1] ?? '');
    return (
      headers !== null &&
      separators !== null &&
      headers.length === separators.length &&
      headers.length > 0 &&
      headers.every((cell) => cell.length > 0) &&
      separators.every((cell) => tableSeparatorCellPattern.test(cell))
    );
  });
}

function hasValidMarkdownLinkAt(source: string, openBracket: number): boolean {
  const closeLabel = source.indexOf('](', openBracket + 1);
  if (closeLabel <= openBracket + 1) return false;

  const closeLink = source.indexOf(')', closeLabel + 2);
  if (closeLink <= closeLabel + 2) return false;

  const destinationAndTitle = source.slice(closeLabel + 2, closeLink);
  let destinationEnd = 0;
  while (
    destinationEnd < destinationAndTitle.length &&
    !/\s/.test(destinationAndTitle[destinationEnd] ?? '')
  ) {
    destinationEnd += 1;
  }
  if (destinationEnd === 0) return false;

  const title = destinationAndTitle.slice(destinationEnd).trim();
  return (
    title.length === 0 ||
    (title.length >= 2 &&
      title.startsWith('"') &&
      title.endsWith('"') &&
      !title.slice(1, -1).includes('"'))
  );
}

function hasMarkdownLink(source: string): boolean {
  let openBracket = source.indexOf('[');
  while (openBracket >= 0) {
    if (hasValidMarkdownLinkAt(source, openBracket)) return true;
    openBracket = source.indexOf('[', openBracket + 1);
  }
  return false;
}

export function looksLikeMarkdown(text: string): boolean {
  const source = text.replace(/\r\n?/g, '\n').trim();
  if (source.length === 0) return false;

  const lines = source.split('\n');

  return (
    headingPattern.test(source) ||
    listPattern.test(source) ||
    quotePattern.test(source) ||
    fencedCodePattern.test(source) ||
    hasMarkdownLink(source) ||
    boldPattern.test(source) ||
    italicPattern.test(source) ||
    horizontalRulePattern.test(source) ||
    hasGfmTable(lines)
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
