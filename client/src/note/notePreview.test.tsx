import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NotePreview, noteListExcerpt } from './notePreview';

// Test-only future-media fixtures; the current #69 API intentionally has no media nodes.
type MediaFixtureNode =
  | { type: 'image'; alt: string }
  | { type: 'text'; text: string }
  | { type: 'attachment'; name: string };

function MediaCardFixture({ nodes }: { nodes: MediaFixtureNode[] }) {
  return (
    <article aria-label="fixture note card">
      <h2>Untitled note</h2>
      <div>
        {nodes.map((node, index) => {
          if (node.type === 'image') {
            return (
              <img
                key={`${node.type}-${index}`}
                data-fixture-node="image"
                src="/notes-test-fixtures/inline-image.png"
                alt={node.alt}
              />
            );
          }
          if (node.type === 'attachment') {
            return (
              <div key={`${node.type}-${index}`} data-fixture-node="attachment">
                File: {node.name}
              </div>
            );
          }
          return (
            <p key={`${node.type}-${index}`} data-fixture-node="text">
              {node.text}
            </p>
          );
        })}
      </div>
    </article>
  );
}

describe('NotePreview', () => {
  it('renders supported rich text structures in document order', () => {
    render(
      <NotePreview
        document={{
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Heading' }],
            },
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
                { type: 'text', text: ' and ' },
                { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
                {
                  type: 'text',
                  text: ' link',
                  marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
                },
              ],
            },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet' }] }],
                },
              ],
            },
            {
              type: 'orderedList',
              content: [
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ordered' }] }],
                },
              ],
            },
            {
              type: 'blockquote',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quote' }] }],
            },
            { type: 'codeBlock', content: [{ type: 'text', text: 'const value = 1;' }] },
            {
              type: 'table',
              content: [
                {
                  type: 'tableRow',
                  content: [
                    {
                      type: 'tableHeader',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }],
                    },
                    {
                      type: 'tableCell',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Value' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        }}
      />
    );

    expect(screen.getByRole('heading', { name: 'Heading', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Bold').tagName).toBe('STRONG');
    expect(screen.getByText('italic').tagName).toBe('EM');
    expect(screen.getByRole('link', { name: 'link' })).toHaveAttribute(
      'rel',
      'noopener noreferrer'
    );
    expect(within(screen.getAllByRole('list')[0]!).getByText('Bullet')).toBeInTheDocument();
    expect(within(screen.getAllByRole('list')[1]!).getByText('Ordered')).toBeInTheDocument();
    expect(screen.getByText('Quote').closest('blockquote')).not.toBeNull();
    expect(screen.getByText('const value = 1;').closest('pre')).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Value' })).toBeInTheDocument();
  });

  it('keeps markup-looking text inert and never makes unsafe links clickable', () => {
    const { container } = render(
      <NotePreview
        document={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }],
            },
          ],
        }}
      />
    );
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();

    const unsafe = render(
      <NotePreview
        document={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'unsafe link',
                  marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
                },
              ],
            },
          ],
        }}
      />
    );
    expect(unsafe.container.querySelector('a')).toBeNull();
  });

  it('renders no invented content for null or empty documents', () => {
    const { container, rerender } = render(<NotePreview document={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<NotePreview document={{ type: 'doc', content: [{ type: 'paragraph' }] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('extracts only leading text from the bounded document in reading order', () => {
    expect(
      noteListExcerpt({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: ' First ' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'second' },
              { type: 'hardBreak' },
              { type: 'text', text: 'line' },
            ],
          },
        ],
      })
    ).toBe('First second line');
    expect(noteListExcerpt(null)).toBe('');
  });

  it('keeps synthetic image and attachment fixtures in document order without promoting later media', () => {
    const boundedContent: MediaFixtureNode[] = [
      { type: 'text', text: 'Leading document text' },
      { type: 'text', text: 'Second bounded block' },
      { type: 'image', alt: 'Late garden image' },
    ];
    const { getAllByRole, getByText } = render(
      <>
        <MediaCardFixture
          nodes={[
            { type: 'image', alt: 'Garden' },
            { type: 'text', text: 'Plan' },
          ]}
        />
        <MediaCardFixture
          nodes={[
            { type: 'text', text: 'Plan' },
            { type: 'image', alt: 'Garden' },
          ]}
        />
        <MediaCardFixture nodes={boundedContent.slice(0, 2)} />
      </>
    );
    const [imageFirst, textFirst, bounded] = getAllByRole('article');
    expect(
      [...imageFirst!.querySelectorAll('[data-fixture-node]')].map((node) =>
        node.getAttribute('data-fixture-node')
      )
    ).toEqual(['image', 'text']);
    expect(
      [...textFirst!.querySelectorAll('[data-fixture-node]')].map((node) =>
        node.getAttribute('data-fixture-node')
      )
    ).toEqual(['text', 'image']);
    expect(bounded!.querySelector('img')).toBeNull();
    expect(getByText('Leading document text')).toBeInTheDocument();
  });

  it('keeps attachment-only fixture cards titled without inventing body text', () => {
    render(<MediaCardFixture nodes={[{ type: 'attachment', name: 'itinerary.pdf' }]} />);

    expect(screen.getByRole('heading', { name: 'Untitled note' })).toBeInTheDocument();
    expect(screen.getByText('File: itinerary.pdf')).toBeInTheDocument();
    expect(screen.queryByText(/note preview|no content/i)).toBeNull();
  });
});
