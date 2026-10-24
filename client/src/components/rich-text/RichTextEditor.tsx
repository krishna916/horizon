import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo, useRef } from 'react';
import { RichTextToolbar } from './RichTextToolbar';
import {
  normalizeRichTextDocument,
  toEditorDocument,
  type RichTextDocument,
} from './richTextDocument';
import { getRichTextExtensions } from './richTextExtensions';

interface RichTextEditorProps {
  readonly value: RichTextDocument | null;
  readonly onChange: (next: RichTextDocument | null) => void;
  readonly disabled?: boolean;
  readonly ariaLabel: string;
}

export function RichTextEditor({
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  const lastEmittedDocument = useRef<string | null>(null);
  const extensions = useMemo(() => getRichTextExtensions(), []);
  const editor = useEditor({
    extensions,
    content: toEditorDocument(value),
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': `${ariaLabel} editor`,
        class: 'rich-text-content',
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (!currentEditor.isInitialized) return;
      const next = normalizeRichTextDocument(currentEditor.getJSON() as RichTextDocument);
      lastEmittedDocument.current = JSON.stringify(next);
      onChangeRef.current(next);
    },
  });

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) return;
    const nextDocument = toEditorDocument(value);
    const serialized = JSON.stringify(nextDocument);
    if (lastEmittedDocument.current === serialized) {
      lastEmittedDocument.current = null;
      return;
    }
    if (JSON.stringify(editor.getJSON()) !== serialized) {
      editor.commands.setContent(nextDocument, { emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) {
    return <div className="rich-text-editor" aria-label={ariaLabel} aria-busy="true" />;
  }

  return (
    <div className="rich-text-editor" data-testid="rich-text-editor">
      <RichTextToolbar editor={editor} disabled={disabled} />
      <EditorContent editor={editor} />
    </div>
  );
}
