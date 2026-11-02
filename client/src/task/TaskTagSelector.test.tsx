import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tagApi } from '@/tag/api';
import type { TaskTag } from './types';
import { TaskTagSelector } from './TaskTagSelector';

vi.mock('@/tag/api', () => ({ tagApi: { suggest: vi.fn() } }));

function renderSelector(props: Partial<React.ComponentProps<typeof TaskTagSelector>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const onChange = props.onChange ?? vi.fn();
  const view = render(<TaskTagSelector value={[]} onChange={onChange} userId={7} {...props} />, {
    wrapper: Wrapper,
  });
  return { ...view, onChange };
}

const response = (items: TaskTag[]) => ({ data: { items } });

describe('TaskTagSelector', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches suggestions for the typed prefix and selects an existing Tag by ID', async () => {
    vi.mocked(tagApi.suggest).mockResolvedValue(response([{ id: 12, name: 'Planning' }]) as never);
    const { onChange } = renderSelector();

    fireEvent.change(screen.getByRole('combobox', { name: 'Add tags' }), {
      target: { value: 'plan' },
    });
    fireEvent.click(await screen.findByRole('option', { name: 'Planning' }));

    expect(tagApi.suggest).toHaveBeenCalledWith('plan');
    expect(onChange).toHaveBeenCalledWith([{ id: 12 }]);
  });

  it('does not add the same name twice and Create stores a draft name without persisting it', async () => {
    vi.mocked(tagApi.suggest).mockResolvedValue(response([]) as never);
    const onChange = vi.fn();
    renderSelector({ value: [{ name: 'Roadmap' }], onChange });
    const input = screen.getByRole('combobox', { name: 'Add tags' });

    fireEvent.change(input, { target: { value: 'roadmap' } });
    expect(screen.queryByRole('option', { name: 'Create tag “roadmap”' })).not.toBeInTheDocument();

    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Build, test 🚀' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Create tag “Build, test 🚀”' }));
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'Roadmap' }, { name: 'Build, test 🚀' }]);
    expect(tagApi.suggest).toHaveBeenCalledTimes(2);
  });

  it('removes a selected chip and exposes an accessible removal label', () => {
    const onChange = vi.fn();
    renderSelector({
      value: [{ id: 12 }],
      knownTags: [{ id: 12, name: 'Planning' }],
      onChange,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag Planning' }));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('supports arrow and Enter selection, Escape dismissal, loading, empty, error, and disabled states', async () => {
    const finishSuggestions: ((value: ReturnType<typeof response>) => void)[] = [];
    vi.mocked(tagApi.suggest).mockImplementation(
      () => new Promise((resolve) => finishSuggestions.push(resolve)) as never
    );
    const { onChange, rerender } = renderSelector();
    const input = screen.getByRole('combobox', { name: 'Add tags' });
    fireEvent.change(input, { target: { value: 'work' } });
    expect(screen.getByRole('status')).toHaveTextContent('Loading tags');
    finishSuggestions[0]?.(
      response([
        { id: 4, name: 'Work' },
        { id: 5, name: 'Workshop' },
      ])
    );
    await screen.findByRole('option', { name: 'Work' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith([{ id: 4 }]);

    fireEvent.change(input, { target: { value: 'absent' } });
    finishSuggestions[1]?.(response([]));
    expect(await screen.findByText('No matching tags')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());

    vi.mocked(tagApi.suggest).mockRejectedValue(new Error('offline'));
    fireEvent.change(input, { target: { value: 'fail' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load tags');
    rerender(<TaskTagSelector value={[]} onChange={onChange} userId={7} disabled />);
    expect(screen.getByRole('combobox', { name: 'Add tags' })).toBeDisabled();
  });

  it('does not show stale prefix results after typing a newer query or changing owner', async () => {
    const pending = new Map<string, (value: ReturnType<typeof response>) => void>();
    let call = 0;
    vi.mocked(tagApi.suggest).mockImplementation(
      (prefix) => new Promise((resolve) => pending.set(`${prefix}:${++call}`, resolve)) as never
    );
    const { rerender } = renderSelector();
    const input = screen.getByRole('combobox', { name: 'Add tags' });
    fireEvent.change(input, { target: { value: 'old' } });
    fireEvent.change(input, { target: { value: 'new' } });
    pending.get('new:2')?.(response([{ id: 2, name: 'New result' }]));
    expect(await screen.findByRole('option', { name: 'New result' })).toBeInTheDocument();
    pending.get('old:1')?.(response([{ id: 1, name: 'Old result' }]));
    expect(screen.queryByRole('option', { name: 'Old result' })).not.toBeInTheDocument();

    rerender(<TaskTagSelector value={[]} onChange={vi.fn()} userId={8} />);
    expect(screen.queryByRole('option', { name: 'New result' })).not.toBeInTheDocument();
    await waitFor(() => expect(tagApi.suggest).toHaveBeenCalledTimes(3));
    expect(tagApi.suggest).toHaveBeenLastCalledWith('new');
    pending.get('new:3')?.(response([{ id: 3, name: 'Owner eight result' }]));
    expect(await screen.findByRole('option', { name: 'Owner eight result' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'New result' })).not.toBeInTheDocument();
  });
});
