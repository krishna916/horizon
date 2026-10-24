import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { getRichTextExtensions } from './richTextExtensions';
import { isSupportedRichTextDocument } from './richTextDocument';

describe('getRichTextExtensions', () => {
  it('parses the supported Markdown structures into backend-compatible JSON', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: getRichTextExtensions(),
      content:
        '# Heading\n\n**bold** and *italic*\n\n1. one\n2. two\n\n> quote\n\n```\ncode\n```\n\n---\n\n| A | B |\n| :--- | ---: |\n| 1 | 2 |',
      contentType: 'markdown',
    });

    expect(isSupportedRichTextDocument(editor.getJSON())).toBe(true);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
      'orderedList',
      'blockquote',
      'codeBlock',
      'horizontalRule',
      'table',
    ]);
    editor.destroy();
  });

  it('marks unsafe Markdown links as unsupported so paste falls back to literal text', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: getRichTextExtensions(),
      content: '[unsafe](javascript:alert%281%29)',
      contentType: 'markdown',
    });

    expect(JSON.stringify(editor.getJSON())).toContain('javascript:');
    expect(isSupportedRichTextDocument(editor.getJSON())).toBe(false);
    editor.destroy();
  });

  it('applies the pinned horizontal-rule and fenced-code input rules on space', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: getRichTextExtensions(),
    });
    typeIntoEditor(editor, '--- ');
    expect(editor.getJSON().content?.[0]?.type).toBe('horizontalRule');

    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
    typeIntoEditor(editor, '``` ');
    typeIntoEditor(editor, 'const value = 1;');
    expect(editor.getJSON().content?.[0]?.type).toBe('codeBlock');
    expect(editor.getText()).toContain('const value = 1;');
    editor.destroy();
  });
});

function typeIntoEditor(editor: Editor, text: string) {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    let handled = false;
    const defaultTransaction = () =>
      editor.state.tr.insertText(character, from, to).scrollIntoView();
    editor.view.someProp('handleTextInput', (handler) => {
      handled = handler(editor.view, from, to, character, defaultTransaction) ?? false;
      return handled;
    });
    if (!handled) {
      editor.view.dispatch(defaultTransaction());
    }
  }
}
