import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RichTextDocument } from './richTextDocument';
import { RichTextEditor } from './RichTextEditor';

const initialDocument: RichTextDocument = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task notes' }] }],
};

describe('RichTextEditor', () => {
  it('keeps the selection when equivalent parent content changes only key order', async () => {
    const onChange = vi.fn();
    const stored = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Docs',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    title: null,
                    class: null,
                    rel: null,
                    target: null,
                    href: 'https://example.com',
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const reordered = {
      content: [
        {
          content: [
            {
              marks: [
                {
                  attrs: {
                    href: 'https://example.com',
                    target: null,
                    rel: null,
                    class: null,
                    title: null,
                  },
                  type: 'link',
                },
              ],
              text: 'Docs',
              type: 'text',
            },
          ],
          type: 'paragraph',
        },
      ],
      type: 'doc',
    };
    const { rerender } = render(
      <RichTextEditor value={stored} onChange={onChange} ariaLabel="Task description" />
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Task description editor')).toBeInTheDocument()
    );
    selectAllInEditor();

    rerender(<RichTextEditor value={reordered} onChange={onChange} ariaLabel="Task description" />);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: [
          expect.objectContaining({
            content: [
              expect.objectContaining({
                text: 'Docs',
                marks: expect.arrayContaining([
                  expect.objectContaining({ type: 'bold' }),
                  expect.objectContaining({ type: 'link' }),
                ]),
              }),
            ],
          }),
        ],
      })
    );
  });

  it('toggles marks and block formatting and emits JSON documents', async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor value={initialDocument} onChange={onChange} ariaLabel="Task description" />
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Task description editor')).toBeInTheDocument()
    );
    expect(onChange).not.toHaveBeenCalled();
    selectAllInEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: [
          expect.objectContaining({
            content: [expect.objectContaining({ text: 'Task notes', marks: [{ type: 'bold' }] })],
          }),
        ],
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Heading 2' }));
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
      content: expect.arrayContaining([
        expect.objectContaining({ type: 'heading', attrs: { level: 2 } }),
      ]),
    });

    const editor = screen.getByLabelText('Task description editor');
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
      content: [
        expect.objectContaining({
          type: 'paragraph',
          content: [expect.objectContaining({ marks: [{ type: 'bold' }] })],
        }),
      ],
    });
  });

  it('validates and applies safe links to the current selection', async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor value={initialDocument} onChange={onChange} ariaLabel="Task description" />
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Task description editor')).toBeInTheDocument()
    );
    expect(onChange).not.toHaveBeenCalled();
    selectAllInEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    fireEvent.change(screen.getByLabelText('Link URL'), {
      target: { value: 'javascript:alert(1)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply link' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter an absolute http, https, or mailto URL.'
    );
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Link URL'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply link' }));
    const renderedLink = screen.getByRole('link', { name: 'Task notes' });
    expect(renderedLink).toHaveAttribute('target', '_blank');
    expect(renderedLink.getAttribute('rel')?.split(/\s+/)).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer'])
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: [
          expect.objectContaining({
            content: [
              expect.objectContaining({
                marks: [
                  expect.objectContaining({
                    type: 'link',
                    attrs: expect.objectContaining({ href: 'https://example.com' }),
                  }),
                ],
              }),
            ],
          }),
        ],
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    fireEvent.change(screen.getByLabelText('Link URL'), {
      target: { value: 'https://example.org/updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply link' }));
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
      content: [
        expect.objectContaining({
          content: [
            expect.objectContaining({
              marks: [
                expect.objectContaining({
                  attrs: expect.objectContaining({ href: 'https://example.org/updated' }),
                }),
              ],
            }),
          ],
        }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
      content: [
        expect.objectContaining({ content: [expect.objectContaining({ text: 'Task notes' })] }),
      ],
    });
  });

  it('inserts tables, adds a row, and deletes a column', async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value={null} onChange={onChange} ariaLabel="Task description" />);
    await waitFor(() =>
      expect(screen.getByLabelText('Task description editor')).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Insert table' }));
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
      content: expect.arrayContaining([expect.objectContaining({ type: 'table' })]),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add table row' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete table column' }));
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
      content: expect.arrayContaining([expect.objectContaining({ type: 'table' })]),
    });
  });

  it('pastes Markdown as structure and rich HTML as formatting in the live editor', async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value={null} onChange={onChange} ariaLabel="Task description" />);
    const editor = await screen.findByLabelText('Task description editor');

    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' ? '# Pasted heading' : ''),
      },
    });
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
        content: expect.arrayContaining([expect.objectContaining({ type: 'heading' })]),
      })
    );

    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) =>
          type === 'text/html'
            ? '<p><strong>Rich HTML</strong></p>'
            : type === 'text/plain'
              ? '**plain text**'
              : '',
      },
    });
    await waitFor(() => expect(editor).toHaveTextContent('Rich HTML'));
    expect(editor.querySelector('strong')).toHaveTextContent('Rich HTML');
    expect(editor).not.toHaveTextContent('**plain text**');
  });

  it('disables editing and keeps formatting controls from submitting the parent form', async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <RichTextEditor
          value={initialDocument}
          onChange={vi.fn()}
          disabled
          ariaLabel="Task description"
        />
        <button type="submit">Save</button>
      </form>
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Task description editor')).toHaveAttribute(
        'contenteditable',
        'false'
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(
      <form onSubmit={onSubmit}>
        <RichTextEditor value={initialDocument} onChange={vi.fn()} ariaLabel="Task description" />
        <button type="submit">Save</button>
      </form>
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Task description editor')).toHaveAttribute(
        'contenteditable',
        'true'
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    fireEvent.change(screen.getByLabelText('Link URL'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply link' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

function selectAllInEditor() {
  const editor = screen.getByLabelText('Task description editor');
  act(() => {
    editor.focus();
    fireEvent.keyDown(editor, { key: 'a', ctrlKey: true });
  });
}
