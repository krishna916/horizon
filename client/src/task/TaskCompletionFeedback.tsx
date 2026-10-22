import { LoaderCircle } from 'lucide-react';
import type { JSX } from 'react';

interface TaskCompletionFeedbackProps {
  readonly taskKey: string;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
}

export function TaskCompletionFeedback({
  taskKey,
  saving,
  error,
  onRetry,
}: TaskCompletionFeedbackProps): JSX.Element | null {
  if (saving) {
    return (
      <output
        aria-label={`Saving ${taskKey}`}
        className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <LoaderCircle
          aria-hidden="true"
          className="size-3.5 animate-spin motion-reduce:animate-none"
        />
        Saving…
      </output>
    );
  }

  if (error) {
    return (
      <div role="alert" className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="text-destructive">Could not save {taskKey}.</span>
        <button
          type="button"
          onClick={onRetry}
          className="font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Retry ${taskKey} completion save`}
        >
          Retry
        </button>
      </div>
    );
  }

  return null;
}
