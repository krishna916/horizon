import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RichTextViewer } from './RichTextViewer';

describe('RichTextViewer', () => {
  it('renders supported formatting as semantic, noneditable HTML', () => {
    render(
      <RichTextViewer
        value={{
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }],
                    },
                  ],
                },
              ],
            },
            {
              type: 'table',
              content: [
                {
                  type: 'tableRow',
                  content: [
                    {
                      type: 'tableCell',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell' }] }],
                    },
                  ],
                },
              ],
            },
            { type: 'codeBlock', content: [{ type: 'text', text: 'const value = 1;' }] },
            {
              type: 'blockquote',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quote' }] }],
            },
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Link',
                  marks: [
                    {
                      type: 'link',
                      attrs: { href: 'https://example.com', target: '_blank' },
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
    expect(screen.getByRole('list')).toContainElement(screen.getByText('Bold'));
    expect(screen.getByText('Bold').tagName).toBe('STRONG');
    expect(screen.getByRole('cell')).toHaveTextContent('Cell');
    expect(screen.getByText('const value = 1;').closest('pre')).not.toBeNull();
    expect(screen.getByText('Quote').closest('blockquote')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Link' })).toHaveAttribute(
      'href',
      'https://example.com'
    );
    expect(screen.getByRole('link', { name: 'Link' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Link' })).toHaveAttribute(
      'rel',
      'noopener noreferrer nofollow'
    );
    expect(document.querySelector('[contenteditable="false"]')).toBeInTheDocument();
  });

  it('renders null as an empty description without injecting HTML', () => {
    const { container } = render(<RichTextViewer value={null} />);

    expect(container.querySelector('[contenteditable="false"]')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
  });

  it('applies the safe outbound policy to compatible href-only legacy links', () => {
    render(
      <RichTextViewer
        value={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Legacy link',
                  marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
                },
              ],
            },
          ],
        }}
      />
    );

    expect(screen.getByRole('link', { name: 'Legacy link' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Legacy link' })).toHaveAttribute(
      'rel',
      'noopener noreferrer nofollow'
    );
  });

  it('safely renders legacy links with explicit null target and rel attributes', () => {
    render(
      <RichTextViewer
        value={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Legacy null link',
                  marks: [
                    {
                      type: 'link',
                      attrs: { href: 'https://example.com', target: null, rel: null },
                    },
                  ],
                },
              ],
            },
          ],
        }}
      />
    );

    const link = screen.getByRole('link', { name: 'Legacy null link' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')?.split(/\s+/)).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer'])
    );
  });

  it.each([
    { href: 'https://example.com', target: '_self', rel: 'noopener noreferrer' },
    { href: 'https://example.com', rel: 'nofollow' },
    { href: 'https://example.com', rel: 'noopener' },
  ])('does not render an anchor for unsafe persisted link attrs: %o', (attrs) => {
    const { container } = render(
      <RichTextViewer
        value={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Unsafe legacy link',
                  marks: [{ type: 'link', attrs }],
                },
              ],
            },
          ],
        }}
      />
    );

    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('This description can’t be displayed.');
  });

  it('does not render an unsafe legacy link or crash on malformed legacy JSON', () => {
    const unsafe = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Unsafe',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    };
    const { rerender, container } = render(<RichTextViewer value={unsafe} />);
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();

    expect(() =>
      rerender(
        <RichTextViewer
          value={{ type: 'doc', content: [{ type: 'unknown', html: '<script>x</script>' }] }}
        />
      )
    ).not.toThrow();
    expect(container.querySelector('script')).toBeNull();
  });
});
