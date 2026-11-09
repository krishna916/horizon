import { EditorContent, useEditor } from '@tiptap/react';
import {
  isSupportedRichTextDocument,
  toEditorDocument,
  type RichTextDocument,
} from './richTextDocument';
import { getRichTextExtensions } from './richTextExtensions';

interface RichTextViewerProps {
  readonly value: RichTextDocument | null;
  readonly ariaLabel?: string;
}

export function RichTextViewer({ value, ariaLabel = 'Task description' }: RichTextViewerProps) {
  const supported = isSupportedRichTextDocument(value);
  const editor = useEditor(
    {
      extensions: getRichTextExtensions(),
      content: supported ? toEditorDocument(value) : toEditorDocument(null),
      editable: false,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          'aria-label': ariaLabel,
          class: 'rich-text-content',
        },
      },
    },
    [value, supported, ariaLabel]
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
