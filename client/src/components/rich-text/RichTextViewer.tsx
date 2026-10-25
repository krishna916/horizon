import { EditorContent, useEditor } from '@tiptap/react';
import {
  isSupportedRichTextDocument,
  toEditorDocument,
  type RichTextDocument,
} from './richTextDocument';
import { getRichTextExtensions } from './richTextExtensions';

interface RichTextViewerProps {
  readonly value: RichTextDocument | null;
}

export function RichTextViewer({ value }: RichTextViewerProps) {
  const supported = isSupportedRichTextDocument(value);
  const editor = useEditor(
    {
      extensions: getRichTextExtensions(),
      content: supported ? toEditorDocument(value) : toEditorDocument(null),
      editable: false,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          'aria-label': 'Task description',
          class: 'rich-text-content',
        },
      },
    },
    [value, supported]
  );

  if (!supported) {
    return <output aria-live="polite">This description can’t be displayed.</output>;
  }

  return (
    <div className="rich-text-viewer" data-testid="rich-text-viewer">
      <EditorContent editor={editor} />
    </div>
  );
}
