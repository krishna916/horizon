import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tagApi } from './api';
import type { Tag } from './types';
import { TagSelector } from './TagSelector';

vi.mock('./api', () => ({ tagApi: { suggest: vi.fn() } }));

function renderSelector(props: Partial<React.ComponentProps<typeof TagSelector>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const onChange = props.onChange ?? vi.fn();
  const view = render(<TagSelector value={[]} onChange={onChange} userId={7} {...props} />, {
    wrapper: Wrapper,
  });
  return { ...view, onChange, queryClient };
}

const response = (items: Tag[]) => ({ data: { items } });

describe('TagSelector', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the accessible combobox keyboard flow to select an existing Tag by ID', async () => {
    vi.mocked(tagApi.suggest).mockResolvedValue(response([{ id: 12, name: 'Planning' }]) as never);
    const { onChange } = renderSelector({ createLabel: 'add' });
    const input = screen.getByRole('combobox', { name: 'Add tags' });
    fireEvent.change(input, { target: { value: 'plan' } });
    const option = await screen.findByRole('option', { name: 'Planning' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(option).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith([{ id: 12 }]);
    expect(tagApi.suggest).toHaveBeenCalledWith('plan');
  });

  it('labels a new Note selection Add tag and stages its name without creating a Tag', async () => {
    vi.mocked(tagApi.suggest).mockResolvedValue(response([]) as never);
    const onChange = vi.fn();
    renderSelector({ createLabel: 'add', onChange });
    const input = screen.getByRole('combobox', { name: 'Add tags' });
    fireEvent.change(input, { target: { value: 'Ideas' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Add tag “Ideas”' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('option', { name: 'Add tag “Ideas”' }));
    expect(onChange).toHaveBeenCalledWith([{ name: 'Ideas' }]);
    expect(tagApi.suggest).toHaveBeenCalledTimes(1);
  });

  it('prevents a case-insensitive duplicate new-name selection', async () => {
    vi.mocked(tagApi.suggest).mockResolvedValue(response([]) as never);
    renderSelector({ value: [{ name: 'Roadmap' }], createLabel: 'add' });
    const input = screen.getByRole('combobox', { name: 'Add tags' });
    fireEvent.change(input, { target: { value: 'roadmap' } });
    await act(async () => Promise.resolve());
    expect(screen.queryByRole('option', { name: /Add tag/i })).not.toBeInTheDocument();
  });

  it('keeps suggestions scoped by owner in the query key', async () => {
    vi.mocked(tagApi.suggest).mockResolvedValue(response([{ id: 12, name: 'Planning' }]) as never);
    const { queryClient } = renderSelector({ userId: 42 });
    fireEvent.change(screen.getByRole('combobox', { name: 'Add tags' }), {
      target: { value: 'plan' },
    });
    expect(await screen.findByRole('option', { name: 'Planning' })).toBeInTheDocument();
    expect(queryClient.getQueryData(['tags', 'suggestions', 42, 'plan'])).toEqual([
      { id: 12, name: 'Planning' },
    ]);
  });

  it('dismisses suggestions with Escape without changing the staged selection', async () => {
    vi.mocked(tagApi.suggest).mockResolvedValue(response([{ id: 12, name: 'Planning' }]) as never);
    const onChange = vi.fn();
    renderSelector({ onChange });
    const input = screen.getByRole('combobox', { name: 'Add tags' });
    fireEvent.change(input, { target: { value: 'plan' } });
    expect(await screen.findByRole('option', { name: 'Planning' })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('option', { name: 'Planning' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
