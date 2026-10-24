import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RichTextDocument } from '@/components/rich-text/richTextDocument';
import { TaskDescriptionField } from './TaskDescriptionField';

const value: RichTextDocument = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Read the ' },
        {
          type: 'text',
          text: 'release notes',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        },
      ],
    },
  ],
};
const unsupportedValue: RichTextDocument = {
  type: 'doc',
  content: [{ type: 'futureWidget', attrs: { label: 'Legacy content' } }],
};

function renderField(overrides: Partial<React.ComponentProps<typeof TaskDescriptionField>> = {}) {
  const onActivate = vi.fn();
  const onChange = vi.fn();
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(
    <TaskDescriptionField
      value={null}
      editing={false}
      draft={null}
      dirty={false}
      pending={false}
      blocked={false}
      error={null}
      onActivate={onActivate}
      onChange={onChange}
      onSave={onSave}
      onCancel={onCancel}
      {...overrides}
    />
  );
  return { onActivate, onChange, onSave, onCancel };
}

describe('TaskDescriptionField', () => {
  it('uses a native button for empty-description activation by click and keyboard', () => {
    const { onActivate } = renderField();
    const placeholder = screen.getByRole('button', { name: 'Add description…' });

    expect(placeholder).toHaveAttribute('type', 'button');
    fireEvent.click(placeholder);

    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('does not activate on a single click, but opens populated content on double click', () => {
    const { onActivate } = renderField({ value });
    const description = screen.getByRole('button', { name: 'Edit task description' });

    fireEvent.click(description);
    expect(onActivate).not.toHaveBeenCalled();
    fireEvent.doubleClick(description);

    expect(onActivate).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'release notes' }).getAttribute('rel')).toContain(
      'noopener noreferrer'
    );
  });

  it('keeps safe links clickable without starting description editing', () => {
    const { onActivate } = renderField({ value });
    const link = screen.getByRole('link', { name: 'release notes' });

    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    fireEvent.click(link);

    expect(onActivate).not.toHaveBeenCalled();
  });

  it('disables the placeholder while another task editor is active', () => {
    const { onActivate } = renderField({ blocked: true });
    const placeholder = screen.getByRole('button', { name: 'Add description…' });

    expect(placeholder).toBeDisabled();
    fireEvent.click(placeholder);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('shows unsupported stored content as unavailable without offering editing', () => {
    const { onActivate } = renderField({ value: unsupportedValue, unavailable: true });

    expect(screen.queryByRole('button', { name: 'Add description…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit task description' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/can’t be displayed/i);
    expect(screen.getByText(/preserved/i)).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByRole('status'));
    fireEvent.keyDown(screen.getByRole('status'), { key: 'Enter' });

    expect(onActivate).not.toHaveBeenCalled();
  });
});
