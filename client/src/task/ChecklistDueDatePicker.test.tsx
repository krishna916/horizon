import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChecklistDueDatePicker } from './ChecklistDueDatePicker';

function renderPicker({
  value = null,
  disabled = false,
  onChange = vi.fn(),
}: {
  value?: string | null;
  disabled?: boolean;
  onChange?: (next: string | null) => void;
} = {}) {
  return {
    onChange,
    ...render(
      <>
        <ChecklistDueDatePicker
          itemTitle="Call florist"
          itemId={4}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
        <button type="button">Outside</button>
      </>
    ),
  };
}

describe('ChecklistDueDatePicker', () => {
  it('opens by keyboard and Escape closes without changing the due date and restores focus', () => {
    const { onChange } = renderPicker({ value: '2026-11-01' });
    const trigger = screen.getByRole('button', { name: 'Set due date for Call florist' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(trigger);

    expect(screen.getByLabelText('Due date for Call florist')).toHaveValue('2026-11-01');
    fireEvent.keyDown(screen.getByLabelText('Due date for Call florist'), {
      key: 'Escape',
    });

    expect(screen.queryByLabelText('Due date for Call florist')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on outside click without changing the due date', async () => {
    const { onChange } = renderPicker({ value: '2026-11-01' });
    fireEvent.click(screen.getByRole('button', { name: 'Set due date for Call florist' }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    });

    expect(screen.queryByLabelText('Due date for Call florist')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('saves a selected date immediately and closes the popover', () => {
    const { onChange } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Set due date for Call florist' }));

    fireEvent.change(screen.getByLabelText('Due date for Call florist'), {
      target: { value: '2026-11-02' },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2026-11-02');
    expect(screen.queryByLabelText('Due date for Call florist')).not.toBeInTheDocument();
  });

  it('clears a due date immediately and closes the popover', () => {
    const { onChange } = renderPicker({ value: '2026-11-01' });
    fireEvent.click(screen.getByRole('button', { name: 'Set due date for Call florist' }));

    fireEvent.click(screen.getByRole('button', { name: 'Clear due date for Call florist' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
    expect(
      screen.queryByRole('button', { name: 'Clear due date for Call florist' })
    ).not.toBeInTheDocument();
  });

  it('does not open when disabled', () => {
    renderPicker({ disabled: true });
    const trigger = screen.getByRole('button', { name: 'Set due date for Call florist' });

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Due date for Call florist')).not.toBeInTheDocument();
  });
});
