import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskSplitView } from './TaskSplitView';

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  callback: ResizeObserverCallback;
  target: Element | null = null;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.instances.push(this);
  }
  observe(target: Element) {
    this.target = target;
  }
  unobserve() {}
  disconnect() {}
  resize(width: number) {
    this.callback(
      [{ target: this.target!, contentRect: { width } as DOMRectReadOnly } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
}

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

describe('TaskSplitView', () => {
  beforeEach(() => {
    TestResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.stubGlobal('PointerEvent', TestPointerEvent);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('measures the workspace and renders a 60/40 split at desktop widths', async () => {
    render(
      <TaskSplitView
        list={<p>Task list</p>}
        detail={<p>Task details</p>}
        isOpen
        listRatio={60}
        onListRatioChange={vi.fn()}
      />
    );
    act(() => TestResizeObserver.instances[0]!.resize(1024));
    const list = await screen.findByTestId('task-list-pane');
    expect(list).toHaveStyle({ width: '611.4px' });
    expect(screen.getByRole('separator', { name: 'Resize task list and details' })).toHaveAttribute(
      'aria-orientation',
      'vertical'
    );
  });

  it('uses the overlay below 845px and returns to the retained split ratio at 845px', async () => {
    const onListRatioChange = vi.fn();
    render(
      <TaskSplitView
        list={<p>Task list</p>}
        detail={<p>Task details</p>}
        isOpen
        listRatio={60}
        onListRatioChange={onListRatioChange}
      />
    );
    act(() => TestResizeObserver.instances[0]!.resize(844));
    expect(await screen.findByTestId('task-split-view')).toHaveAttribute('data-layout', 'overlay');
    expect(await screen.findByRole('dialog', { name: 'Task details' })).toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(screen.getByText('Task list')).toBeInTheDocument();
    expect(onListRatioChange).not.toHaveBeenCalled();
    act(() => TestResizeObserver.instances[0]!.resize(845));
    expect(
      await screen.findByRole('separator', { name: 'Resize task list and details' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Task details' })).not.toBeInTheDocument();
  });

  it('supports keyboard and workspace-relative pointer resizing within minimum widths', async () => {
    const onListRatioChange = vi.fn();
    render(
      <TaskSplitView
        list={<p>Task list</p>}
        detail={<p>Task details</p>}
        isOpen
        listRatio={60}
        onListRatioChange={onListRatioChange}
      />
    );
    act(() => TestResizeObserver.instances[0]!.resize(1024));
    const separator = await screen.findByRole('separator', {
      name: 'Resize task list and details',
    });
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(onListRatioChange).toHaveBeenCalledWith(58);
    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 600 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 650 });
    expect(onListRatioChange).toHaveBeenLastCalledWith(63.79);
    fireEvent.pointerUp(separator, { pointerId: 1 });
    act(() => TestResizeObserver.instances[0]!.resize(845));
    await waitFor(() => expect(separator).toHaveAttribute('aria-valuemin', '57'));
  });
});
