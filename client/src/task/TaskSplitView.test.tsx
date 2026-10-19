import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
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

function ControlledTaskSplitView({ initialRatio = 60 }: { initialRatio?: number }) {
  const [ratio, setRatio] = useState(initialRatio);
  return (
    <TaskSplitView
      list={<p>Task list</p>}
      detail={<p>Task details</p>}
      isOpen
      listRatio={ratio}
      onListRatioChange={setRatio}
    />
  );
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

  it('keeps a continuous drag active across controlled ratio updates', async () => {
    render(<ControlledTaskSplitView />);
    act(() => TestResizeObserver.instances[0]!.resize(1024));
    const list = await screen.findByTestId('task-list-pane');
    const separator = await screen.findByRole('separator', {
      name: 'Resize task list and details',
    });

    fireEvent.pointerDown(separator, { pointerId: 11, clientX: 600 });
    for (const position of [550, 580, 630]) {
      fireEvent.pointerMove(window, { pointerId: 11, clientX: position });
      expect(Number.parseFloat(list.style.width)).toBeCloseTo(position, 1);
    }

    fireEvent.pointerUp(window, { pointerId: 11 });
    fireEvent.pointerMove(window, { pointerId: 11, clientX: 640 });
    expect(Number.parseFloat(list.style.width)).toBeCloseTo(630, 1);
  });

  it.each([
    { requestedRatio: 75, key: 'ArrowLeft', expectedRatio: 62.67, direction: 'left' },
    { requestedRatio: 40, key: 'ArrowRight', expectedRatio: 49.11, direction: 'right' },
  ])(
    'moves $direction from the visible split when the requested $requestedRatio% ratio is constrained',
    async ({ requestedRatio, key, expectedRatio, direction }) => {
      const onListRatioChange = vi.fn();
      render(
        <TaskSplitView
          list={<p>Task list</p>}
          detail={<p>Task details</p>}
          isOpen
          listRatio={requestedRatio}
          onListRatioChange={onListRatioChange}
        />
      );
      act(() => TestResizeObserver.instances[0]!.resize(1024));
      const list = await screen.findByTestId('task-list-pane');
      const initialWidth = Number.parseFloat(list.style.width);
      const separator = await screen.findByRole('separator', {
        name: 'Resize task list and details',
      });

      fireEvent.keyDown(separator, { key });

      expect(onListRatioChange).toHaveBeenCalledTimes(1);
      expect(onListRatioChange).toHaveBeenCalledWith(expectedRatio);
      if (direction === 'left') {
        expect(expectedRatio).toBeLessThan((initialWidth / 1019) * 100);
      } else {
        expect(expectedRatio).toBeGreaterThan((initialWidth / 1019) * 100);
      }
    }
  );

  it.each([
    { requestedRatio: 60, key: 'ArrowRight' },
    { requestedRatio: 67, key: 'ArrowLeft' },
  ])(
    'retains the requested $requestedRatio% split when keyboard input cannot move the constrained splitter',
    async ({ requestedRatio, key }) => {
      let ratio = requestedRatio;
      const onListRatioChange = vi.fn((nextRatio: number) => {
        ratio = nextRatio;
      });
      const renderSplit = () => (
        <TaskSplitView
          list={<p>Task list</p>}
          detail={<p>Task details</p>}
          isOpen
          listRatio={ratio}
          onListRatioChange={onListRatioChange}
        />
      );
      const { rerender } = render(renderSplit());
      act(() => TestResizeObserver.instances[0]!.resize(1024));
      const initialList = await screen.findByTestId('task-list-pane');
      const initialWidth = initialList.style.width;

      act(() => TestResizeObserver.instances[0]!.resize(845));
      const separator = await screen.findByRole('separator', {
        name: 'Resize task list and details',
      });
      onListRatioChange.mockClear();
      fireEvent.keyDown(separator, { key });
      expect(onListRatioChange).not.toHaveBeenCalled();

      act(() => TestResizeObserver.instances[0]!.resize(1024));
      rerender(renderSplit());
      expect(await screen.findByTestId('task-list-pane')).toHaveStyle({ width: initialWidth });
      expect(ratio).toBe(requestedRatio);
    }
  );

  it('cancels an active drag when the workspace enters overlay mode', async () => {
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
    fireEvent.pointerDown(separator, { pointerId: 4, clientX: 600 });
    act(() => TestResizeObserver.instances[0]!.resize(844));
    await screen.findByRole('dialog', { name: 'Task details' });
    onListRatioChange.mockClear();
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 620 });
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 620 });
    expect(onListRatioChange).not.toHaveBeenCalled();
  });

  it('ends pointer updates on cancellation and unmount', async () => {
    const onListRatioChange = vi.fn();
    const { unmount } = render(
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
    fireEvent.pointerDown(separator, { pointerId: 5, clientX: 600 });
    fireEvent.pointerCancel(window, { pointerId: 5 });
    onListRatioChange.mockClear();
    fireEvent.pointerMove(window, { pointerId: 5, clientX: 640 });
    expect(onListRatioChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(separator, { pointerId: 6, clientX: 600 });
    unmount();
    fireEvent.pointerMove(window, { pointerId: 6, clientX: 640 });
    expect(onListRatioChange).not.toHaveBeenCalled();
  });
});
