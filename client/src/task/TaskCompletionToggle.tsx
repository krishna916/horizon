import { Check } from 'lucide-react';
import type { JSX } from 'react';

interface TaskCompletionToggleProps {
  readonly taskKey: string;
  readonly completed: boolean;
  readonly onToggle: () => void;
}

export function TaskCompletionToggle({
  taskKey,
  completed,
  onToggle,
}: TaskCompletionToggleProps): JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={completed}
      aria-label={`${completed ? 'Reopen' : 'Complete'} ${taskKey}`}
      onClick={onToggle}
      className={`mt-0.5 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${completed ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 text-transparent hover:border-primary hover:text-primary'}`}
    >
      {completed && <Check aria-hidden="true" className="size-3.5" strokeWidth={2.5} />}
    </button>
  );
}
