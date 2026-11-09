import type { ReactNode } from 'react';
import {
  isSafeRichTextHref,
  isSupportedRichTextDocument,
  normalizeRichTextDocument,
  type RichTextDocument,
} from '@/components/rich-text/richTextDocument';

type RichTextNode = Record<string, unknown>;

function isNode(value: unknown): value is RichTextNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nodeChildren(node: RichTextNode): RichTextNode[] {
  return Array.isArray(node.content) ? node.content.filter(isNode) : [];
}

function stableNodeKey(node: RichTextNode): string {
  const serialized = JSON.stringify(node);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${String(node.type)}-${(hash >>> 0).toString(36)}`;
}

function renderChildren(node: RichTextNode, interactiveLinks: boolean): ReactNode[] {
  const occurrences = new Map<string, number>();
  return nodeChildren(node).map((child) => {
    const baseKey = stableNodeKey(child);
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    return renderNode(child, `${baseKey}-${occurrence}`, interactiveLinks);
  });
}

function renderText(node: RichTextNode, interactiveLinks: boolean): ReactNode {
  let content: ReactNode = typeof node.text === 'string' ? node.text : '';
  const marks = Array.isArray(node.marks) ? node.marks.filter(isNode) : [];

  marks.forEach((mark) => {
    switch (mark.type) {
      case 'bold':
        content = <strong>{content}</strong>;
        break;
      case 'italic':
        content = <em>{content}</em>;
        break;
      case 'code':
        content = <code>{content}</code>;
        break;
      case 'link': {
        const attrs = isNode(mark.attrs) ? mark.attrs : {};
        if (isSafeRichTextHref(attrs.href)) {
          const title = typeof attrs.title === 'string' ? attrs.title : undefined;
          content = interactiveLinks ? (
            <a href={attrs.href} target="_blank" rel="noopener noreferrer" title={title}>
              {content}
            </a>
          ) : (
            <span className="underline decoration-dotted" title={title}>
              {content}
            </span>
          );
        }
        break;
      }
    }
  });

  return content;
}

function renderNode(node: RichTextNode, key: string, interactiveLinks: boolean): ReactNode {
  const children = renderChildren(node, interactiveLinks);
  const attrs = isNode(node.attrs) ? node.attrs : {};

  switch (node.type) {
    case 'doc':
      return <div key={key}>{children}</div>;
    case 'text':
      return <span key={key}>{renderText(node, interactiveLinks)}</span>;
    case 'hardBreak':
      return <br key={key} />;
    case 'horizontalRule':
      return <hr key={key} />;
    case 'paragraph':
      return <p key={key}>{children}</p>;
    case 'heading': {
      const level = attrs.level;
      if (level === 1) return <h1 key={key}>{children}</h1>;
      if (level === 2) return <h2 key={key}>{children}</h2>;
      return <h3 key={key}>{children}</h3>;
    }
    case 'bulletList':
      return <ul key={key}>{children}</ul>;
    case 'orderedList':
      return (
        <ol key={key} start={typeof attrs.start === 'number' ? attrs.start : undefined}>
          {children}
        </ol>
      );
    case 'listItem':
      return <li key={key}>{children}</li>;
    case 'blockquote':
      return <blockquote key={key}>{children}</blockquote>;
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{children}</code>
        </pre>
      );
    case 'table':
      return (
        <div key={key} className="overflow-x-auto">
          <table>
            <tbody>{children}</tbody>
          </table>
        </div>
      );
    case 'tableRow':
      return <tr key={key}>{children}</tr>;
    case 'tableHeader':
      return (
        <th key={key} scope="col">
          {children}
        </th>
      );
    case 'tableCell':
      return <td key={key}>{children}</td>;
    default:
      return null;
  }
}

export function NotePreview({
  document,
  interactiveLinks = true,
}: {
  readonly document: RichTextDocument | null;
  readonly interactiveLinks?: boolean;
}) {
  if (document === null) return null;
  if (!isSupportedRichTextDocument(document)) {
    return <output aria-live="polite">This preview can’t be displayed.</output>;
  }

  const normalized = normalizeRichTextDocument(document);
  if (normalized === null) return null;

  return (
    <div className="note-preview">
      {renderNode(normalized, stableNodeKey(normalized), interactiveLinks)}
    </div>
  );
}

export function noteListExcerpt(document: RichTextDocument | null): string {
  if (document === null || !isSupportedRichTextDocument(document)) return '';
  const normalized = normalizeRichTextDocument(document);
  if (normalized === null) return '';

  const text: string[] = [];
  const visit = (node: RichTextNode) => {
    if (node.type === 'text' && typeof node.text === 'string') {
      text.push(node.text);
      return;
    }
    if (node.type === 'hardBreak') {
      text.push(' ');
      return;
    }
    nodeChildren(node).forEach(visit);
  };
  visit(normalized);
  return text.join('').replace(/\s+/g, ' ').trim();
}
