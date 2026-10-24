import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { getRichTextExtensions } from './richTextExtensions';
import { looksLikeMarkdown } from './markdownPaste';
import { isSupportedRichTextDocument } from './richTextDocument';

describe('looksLikeMarkdown', () => {
  it.each([
    ['# Heading', 'heading'],
    ['## Heading', 'heading'],
    ['### Heading', 'heading'],
    ['**bold**', 'bold'],
    ['*italic*', 'italic'],
    ['[docs](https://example.com)', 'link'],
    ['- first\n- second', 'bullet list'],
    ['1. first\n2. second', 'ordered list'],
    ['- parent\n  - child', 'nested list'],
    ['```js\nconst value = 1;\n```', 'fenced code'],
    ['> quoted text', 'quote'],
    ['---', 'horizontal rule'],
    ['| Name | Value |\n| --- | --- |\n| A | B |', 'GFM table'],
    ['## Plan\n\n- **bold**\n- [docs](https://example.com)', 'combined blocks'],
  ])('recognizes %s as %s', (text) => {
    expect(looksLikeMarkdown(text)).toBe(true);
  });

  it.each(['Ordinary words and punctuation.', 'literal *asterisk', 'A separator --- mid-sentence'])(
    'leaves ambiguous prose literal: %s',
    (text) => {
      expect(looksLikeMarkdown(text)).toBe(false);
    }
  );
});

describe('Markdown paste extension', () => {
  it('parses supported Markdown into the shared schema and inserts at the current selection', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: getRichTextExtensions(),
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'BeforeAfter' }] }],
      },
    });
    editor.commands.setTextSelection(7);
    const handled = dispatchPaste(editor, '# Heading\n\n- **bold**\n- [docs](https://example.com)');

    expect(handled).toBe(true);
    expect(isSupportedRichTextDocument(editor.getJSON())).toBe(true);
    expect(editor.getJSON().content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'heading' }),
        expect.objectContaining({ type: 'bulletList' }),
      ])
    );
    expect(editor.getText()).toContain('Before');
    expect(editor.getText()).toContain('After');
    expect(editor.getText()).toContain('Heading');

    editor.commands.undo();
    expect(editor.getText()).toBe('BeforeAfter');
    editor.destroy();
  });

  it('leaves rich HTML paste to the browser parser instead of double handling its plain text', () => {
    const editor = createEditor();
    const before = editor.getJSON();
    const handled = dispatchPaste(editor, '**plain text**', '<p><strong>rich text</strong></p>');

    expect(handled).toBe(false);
    expect(editor.getJSON()).toEqual(before);
    editor.destroy();
  });

  it('leaves plain prose and ambiguous markers literal', () => {
    const editor = createEditor();
    for (const text of ['Literal *asterisk', 'A separator --- mid-sentence']) {
      expect(dispatchPaste(editor, text)).toBe(false);
    }
    expect(editor.getText()).toBe('');
    editor.destroy();
  });

  it('does not create an unsafe link and falls back for malformed parsed content', () => {
    const editor = createEditor();
    const unsafeHandled = dispatchPaste(editor, '[unsafe](javascript:alert%281%29)');
    expect(editor.getJSON()).not.toEqual(
      expect.objectContaining({
        content: expect.arrayContaining([expect.objectContaining({ type: 'image' })]),
      })
    );
    expect(editor.getJSON()).not.toMatchObject({
      content: expect.arrayContaining([
        expect.objectContaining({
          marks: [
            expect.objectContaining({
              type: 'link',
              attrs: { href: expect.stringMatching(/^javascript:/) },
            }),
          ],
        }),
      ]),
    });
    expect(unsafeHandled).toBe(false);

    expect(dispatchPaste(editor, '![image](https://example.com/x.png)')).toBe(false);
    expect(editor.getText()).toBe('');
    editor.destroy();
  });
});

function createEditor() {
  return new Editor({
    element: document.createElement('div'),
    extensions: getRichTextExtensions(),
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
}

function dispatchPaste(editor: Editor, text: string, html = ''): boolean {
  const clipboardData = {
    getData: (type: string) => (type === 'text/html' ? html : type === 'text/plain' ? text : ''),
  };
  const event = { clipboardData, preventDefault: () => undefined } as unknown as ClipboardEvent;
  let handled = false;
  editor.view.someProp('handlePaste', (handler) => {
    handled = handler(editor.view, event, editor.state.tr.doc.slice(0, 0)) ?? false;
    return handled;
  });
  return handled;
}
