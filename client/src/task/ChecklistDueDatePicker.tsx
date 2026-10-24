import { CalendarDays } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Popover } from 'radix-ui';

interface ChecklistDueDatePickerProps {
  readonly itemTitle: string;
  readonly itemId: number;
  readonly value: string | null;
  readonly disabled: boolean;
  readonly onChange: (next: string | null) => void;
}

export function ChecklistDueDatePicker({
  itemTitle,
  itemId,
  value,
  disabled,
  onChange,
}: ChecklistDueDatePickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(open);

  useLayoutEffect(() => {
    if (wasOpenRef.current && !open) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);

  return (
    <div className="flex items-center gap-1">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            ref={triggerRef}
            aria-label={`Set due date for ${itemTitle}`}
            disabled={disabled}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CalendarDays aria-hidden="true" className="size-4" />
            {value ? <span>{value}</span> : <span className="sr-only">Add date</span>}
          </button>
        </Popover.Trigger>
        <Popover.Content
          align="end"
          side="bottom"
          sideOffset={4}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
          className="z-20 space-y-2 rounded-md border border-border bg-background p-3 shadow-md"
        >
          <label className="block space-y-1 text-sm" htmlFor={`checklist-date-${itemId}`}>
            <span className="text-foreground">Due date</span>
            <input
              id={`checklist-date-${itemId}`}
              type="date"
              aria-label={`Due date for ${itemTitle}`}
              value={value ?? ''}
              disabled={disabled}
              onChange={(event) => {
                onChange(event.currentTarget.value || null);
                setOpen(false);
              }}
              className="block min-h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          {value && (
            <button
              type="button"
              aria-label={`Clear due date for ${itemTitle}`}
              disabled={disabled}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="rounded-sm px-2 py-1 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear date
            </button>
          )}
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}
