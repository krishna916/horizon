import type { PointerEvent as ReactPointerEvent, ReactNode, KeyboardEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TaskOverlay } from './TaskOverlay';

export const SPLITTER_PX = 5;
export const LIST_MIN_PX = 480;
export const DETAIL_MIN_PX = 360;
export const OVERLAY_BELOW_PX = 845;
export const DEFAULT_LIST_PERCENT = 60;

interface TaskSplitViewProps {
  readonly list: ReactNode;
  readonly detail: ReactNode;
  readonly isOpen: boolean;
  readonly listRatio: number;
  readonly onListRatioChange: (ratio: number) => void;
  readonly onCloseOverlay?: () => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const toPercent = (pixels: number, innerWidth: number) =>
  Number(((pixels / innerWidth) * 100).toFixed(2));

export function TaskSplitView({
  list,
  detail,
  isOpen,
  listRatio,
  onListRatioChange,
  onCloseOverlay = () => {},
}: TaskSplitViewProps): React.JSX.Element {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const separatorRef = useRef<HTMLDivElement>(null);
  const dragPointerRef = useRef<number | null>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setWorkspaceWidth(width);
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  const innerWidth = Math.max(0, workspaceWidth - SPLITTER_PX);
  const minimumListRatio = innerWidth ? toPercent(LIST_MIN_PX, innerWidth) : 0;
  const maximumListRatio = innerWidth ? toPercent(innerWidth - DETAIL_MIN_PX, innerWidth) : 100;
  const listPixels = innerWidth
    ? clamp((innerWidth * listRatio) / 100, LIST_MIN_PX, innerWidth - DETAIL_MIN_PX)
    : 0;
  const actualListRatio = innerWidth ? toPercent(listPixels, innerWidth) : listRatio;
  const atOverlayWidth = workspaceWidth > 0 && workspaceWidth < OVERLAY_BELOW_PX;

  const updateFromPointer = useCallback(
    (clientX: number) => {
      const left = workspaceRef.current?.getBoundingClientRect().left ?? 0;
      if (!innerWidth) return;
      const pixels = clamp(clientX - left, LIST_MIN_PX, innerWidth - DETAIL_MIN_PX);
      onListRatioChange(toPercent(pixels, innerWidth));
    },
    [innerWidth, onListRatioChange]
  );

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (event.pointerId === dragPointerRef.current) updateFromPointer(event.clientX);
    };
    const stopDrag = (event: PointerEvent) => {
      if (event.pointerId !== dragPointerRef.current) return;
      dragPointerRef.current = null;
      try {
        separatorRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already have been released by the browser.
      }
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
    };
  }, [updateFromPointer]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (atOverlayWidth) return;
    dragPointerRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some browsers do not allow capture during synthetic or interrupted input.
    }
    event.preventDefault();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    if (!innerWidth) return;
    const delta = event.key === 'ArrowLeft' ? -2 : 2;
    const next = clamp(actualListRatio + delta, minimumListRatio, maximumListRatio);
    onListRatioChange(Number(next.toFixed(2)));
  };

  if (atOverlayWidth) {
    return (
      <div ref={workspaceRef} data-testid="task-split-view" data-layout="overlay" className="relative flex h-full min-h-0 w-full">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{list}</div>
        <TaskOverlay open={isOpen} onClose={onCloseOverlay}>
          {detail}
        </TaskOverlay>
      </div>
    );
  }

  return (
    <div ref={workspaceRef} data-testid="task-split-view" data-layout="split" className="flex h-full min-h-0 w-full overflow-hidden">
      <div data-testid="task-list-pane" className="min-h-0 min-w-0 overflow-y-auto" style={{ width: `${actualListRatio}%` }}>
        {list}
      </div>
      {isOpen && (workspaceWidth === 0 || workspaceWidth >= OVERLAY_BELOW_PX) && (
        // A focusable separator is the ARIA pattern for keyboard-operable split panes.
        // eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions
        <div
          ref={separatorRef}
          role="separator"
          aria-label="Resize task list and details"
          aria-orientation="vertical"
          aria-valuemin={Math.floor(minimumListRatio)}
          aria-valuemax={Math.ceil(maximumListRatio)}
          aria-valuenow={Math.round(actualListRatio)}
          // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          className="relative z-10 h-full w-[5px] shrink-0 cursor-col-resize touch-none bg-border before:absolute before:inset-y-0 before:-left-2 before:w-[21px] before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}
      {isOpen && (workspaceWidth === 0 || workspaceWidth >= OVERLAY_BELOW_PX) && (
        <div data-testid="task-detail-pane" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {detail}
        </div>
      )}
    </div>
  );
}
