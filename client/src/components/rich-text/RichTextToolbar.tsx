import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Plus,
  Quote,
  Table2,
  Trash2,
  Unlink,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isSafeRichTextHref } from './richTextDocument';

interface RichTextToolbarProps {
  readonly editor: Editor;
  readonly disabled: boolean;
}

export function RichTextToolbar({ editor, disabled }: RichTextToolbarProps) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [href, setHref] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [, setSelectionVersion] = useState(0);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const linkActive = editor.isActive('link');

  function openLinkDialog() {
    setHref(String(editor.getAttributes('link').href ?? ''));
    setLinkError(null);
    setLinkDialogOpen(true);
  }

  useEffect(() => {
    const updateSelection = () => setSelectionVersion((version) => version + 1);
    editor.on('selectionUpdate', updateSelection);
    editor.on('transaction', updateSelection);
    return () => {
      editor.off('selectionUpdate', updateSelection);
      editor.off('transaction', updateSelection);
    };
  }, [editor]);

  useEffect(() => {
    if (linkDialogOpen) linkInputRef.current?.focus();
  }, [linkDialogOpen]);

  function applyLink() {
    const normalizedHref = href.trim();
    if (!isSafeRichTextHref(normalizedHref)) {
      setLinkError('Enter an absolute http, https, or mailto URL.');
      return;
    }
    editor
      .chain()
      .focus()
      .setLink({ href: normalizedHref, target: '_blank', rel: 'noopener noreferrer nofollow' })
      .run();
    setLinkDialogOpen(false);
  }

  function removeLink() {
    editor.chain().focus().unsetLink().run();
    setLinkDialogOpen(false);
  }

  function toolbarButton(
    label: string,
    icon: ReactNode,
    action: () => void,
    active = false,
    unavailable = false
  ) {
    return (
      <Button
        key={label}
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={label}
        aria-pressed={active}
        title={label}
        disabled={disabled || unavailable}
        onMouseDown={(event) => event.preventDefault()}
        onClick={action}
      >
        {icon}
      </Button>
    );
  }

  return (
    <div className="rich-text-toolbar" role="toolbar" aria-label="Description formatting">
      {toolbarButton(
        'Bold',
        <Bold />,
        () => editor.chain().focus().toggleBold().run(),
        editor.isActive('bold')
      )}
      {toolbarButton(
        'Italic',
        <Italic />,
        () => editor.chain().focus().toggleItalic().run(),
        editor.isActive('italic')
      )}
      {toolbarButton(
        'Heading 1',
        <Heading1 />,
        () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        editor.isActive('heading', { level: 1 })
      )}
      {toolbarButton(
        'Heading 2',
        <Heading2 />,
        () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        editor.isActive('heading', { level: 2 })
      )}
      {toolbarButton(
        'Heading 3',
        <Heading3 />,
        () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        editor.isActive('heading', { level: 3 })
      )}
      {toolbarButton(
        'Bullet list',
        <List />,
        () => editor.chain().focus().toggleBulletList().run(),
        editor.isActive('bulletList')
      )}
      {toolbarButton(
        'Numbered list',
        <ListOrdered />,
        () => editor.chain().focus().toggleOrderedList().run(),
        editor.isActive('orderedList')
      )}
      {toolbarButton('Link', <LinkIcon />, openLinkDialog, linkActive)}
      {toolbarButton(
        'Code block',
        <Code />,
        () => editor.chain().focus().toggleCodeBlock().run(),
        editor.isActive('codeBlock')
      )}
      {toolbarButton(
        'Blockquote',
        <Quote />,
        () => editor.chain().focus().toggleBlockquote().run(),
        editor.isActive('blockquote')
      )}
      {toolbarButton('Horizontal rule', <Minus />, () =>
        editor.chain().focus().setHorizontalRule().run()
      )}
      {toolbarButton('Insert table', <Table2 />, () =>
        editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
      )}
      {toolbarButton(
        'Add table row',
        <Plus />,
        () => editor.chain().focus().addRowAfter().run(),
        false,
        !editor.isActive('table')
      )}
      {toolbarButton(
        'Add table column',
        <Plus />,
        () => editor.chain().focus().addColumnAfter().run(),
        false,
        !editor.isActive('table')
      )}
      {toolbarButton(
        'Delete table row',
        <Trash2 />,
        () => editor.chain().focus().deleteRow().run(),
        false,
        !editor.isActive('table')
      )}
      {toolbarButton(
        'Delete table column',
        <Trash2 />,
        () => editor.chain().focus().deleteColumn().run(),
        false,
        !editor.isActive('table')
      )}
      {toolbarButton(
        'Delete table',
        <Unlink />,
        () => editor.chain().focus().deleteTable().run(),
        false,
        !editor.isActive('table')
      )}
      {linkDialogOpen && (
        <dialog open className="rich-text-link-dialog" aria-label="Edit link">
          <label htmlFor="rich-text-link-url" className="text-xs font-medium text-foreground">
            Link URL
          </label>
          <Input
            ref={linkInputRef}
            id="rich-text-link-url"
            type="text"
            value={href}
            aria-invalid={linkError !== null}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
            }}
            onChange={(event) => {
              setHref(event.currentTarget.value);
              setLinkError(null);
            }}
          />
          {linkError && (
            <p role="alert" className="text-xs text-destructive">
              {linkError}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onMouseDown={(event) => event.preventDefault()}
              onClick={applyLink}
            >
              Apply link
            </Button>
            {linkActive && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onMouseDown={(event) => event.preventDefault()}
                onClick={removeLink}
              >
                Remove link
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setLinkDialogOpen(false)}
            >
              Cancel link
            </Button>
          </div>
        </dialog>
      )}
    </div>
  );
}
