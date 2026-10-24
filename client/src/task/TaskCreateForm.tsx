import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/rich-text/RichTextEditor';
import { TaskCreateChecklist } from './TaskCreateChecklist';
import type { CreateChecklistDraft } from './TaskCreateChecklist';
import type { CreateTaskPayload, TaskDetail } from './types';
import { useCreateTask } from './useCreateTask';

const taskCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Enter a task title.')
    .max(255, 'Title must be 255 characters or fewer.'),
  description: z.record(z.string(), z.unknown()).nullable(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).or(z.literal('')),
  dueDate: z.string(),
});

type TaskCreateInput = z.input<typeof taskCreateSchema>;
type TaskCreateValues = z.output<typeof taskCreateSchema>;

interface TaskCreateRecovery {
  payload: CreateTaskPayload;
  requestKey: string;
  ownerId: number;
}

interface TaskCreateFormProps {
  readonly userId: number;
  readonly onCreated: (task: TaskDetail) => void;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onSubmittingChange: (pending: boolean) => void;
  readonly onCancel: () => void;
}

function fieldErrors(error: unknown): Record<string, string> {
  if (!isAxiosError(error) || error.response?.status !== 400) {
    return {};
  }
  const data: unknown = error.response.data;
  if (typeof data !== 'object' || data === null || !('errors' in data)) {
    return {};
  }
  const errors = data.errors;
  if (typeof errors !== 'object' || errors === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(errors).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

function errorMessage(error: unknown): string {
  if (isAxiosError(error) && typeof error.response?.data === 'object' && error.response.data) {
    const data = error.response.data as { detail?: unknown; title?: unknown };
    if (typeof data.detail === 'string') return data.detail;
    if (typeof data.title === 'string') return data.title;
  }
  return 'We could not create this task. Please try again.';
}

function isAmbiguousFailure(error: unknown): boolean {
  if (!isAxiosError(error)) {
    return true;
  }
  const status = error.response?.status;
  return status === undefined || status === 408 || status >= 500;
}

export function TaskCreateForm({
  userId,
  onCreated,
  onDirtyChange,
  onSubmittingChange,
  onCancel,
}: TaskCreateFormProps): React.JSX.Element {
  const { createTask } = useCreateTask(userId);
  const form = useForm<TaskCreateInput, unknown, TaskCreateValues>({
    resolver: zodResolver(taskCreateSchema),
    defaultValues: { title: '', description: null, priority: '', dueDate: '' },
  });
  const [recovery, setRecovery] = useState<TaskCreateRecovery | null>(null);
  const [checklistDrafts, setChecklistDrafts] = useState<CreateChecklistDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const currentUserId = useRef<number | undefined>(userId);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const submitting = useRef(false);
  const cancelled = useRef(false);
  const completed = useRef(false);
  const mounted = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mounted.current = true;
    currentUserId.current = userId;
    return () => {
      mounted.current = false;
      currentUserId.current = undefined;
    };
  }, [userId]);

  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);

  useEffect(() => {
    onDirtyChangeRef.current(form.formState.isDirty || checklistDrafts.length > 0);
  }, [checklistDrafts.length, form.formState.isDirty]);

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  const reportDirtyFromCurrentValues = () => {
    const values = form.getValues();
    onDirtyChangeRef.current(
      values.title !== '' ||
        values.description !== null ||
        values.priority !== '' ||
        values.dueDate !== '' ||
        checklistDrafts.length > 0
    );
  };
  const handleChecklistDraftChange = (items: CreateChecklistDraft[]) => {
    setChecklistDrafts(items);
    setFormError(null);
    const values = form.getValues();
    onDirtyChangeRef.current(
      values.title !== '' ||
        values.description !== null ||
        values.priority !== '' ||
        values.dueDate !== '' ||
        items.length > 0
    );
  };
  const titleField = form.register('title');
  const priorityField = form.register('priority');
  const dueDateField = form.register('dueDate');

  const reportFailure = (error: unknown, snapshot: TaskCreateRecovery) => {
    const errors = fieldErrors(error);
    const recognizedFields = ['title', 'description', 'priority', 'dueDate'];
    for (const [field, message] of Object.entries(errors)) {
      if (recognizedFields.includes(field)) {
        form.setError(field as keyof TaskCreateInput, { type: 'server', message });
      }
    }
    if (Object.keys(errors).some((field) => recognizedFields.includes(field))) {
      setRecovery(null);
      setFormError(null);
      return;
    }
    if (isAmbiguousFailure(error)) {
      setRecovery(snapshot);
      setFormError('We could not confirm whether this task was created. Retry the same request.');
      return;
    }
    setRecovery(null);
    setFormError(errorMessage(error));
  };

  const send = async (snapshot: TaskCreateRecovery) => {
    if (submitting.current || completed.current || cancelled.current) {
      return;
    }
    if (currentUserId.current !== snapshot.ownerId) {
      setFormError('Your session changed. Close this form and try again.');
      return;
    }
    submitting.current = true;
    setIsSubmitting(true);
    onSubmittingChange(true);
    setFormError(null);
    try {
      const task = await createTask(snapshot.payload, snapshot.requestKey);
      if (mounted.current && !cancelled.current && currentUserId.current === snapshot.ownerId) {
        completed.current = true;
        setRecovery(null);
        onCreated(task);
      }
    } catch (error) {
      if (mounted.current && currentUserId.current === snapshot.ownerId) {
        reportFailure(error, snapshot);
      }
    } finally {
      submitting.current = false;
      if (mounted.current && currentUserId.current === snapshot.ownerId) {
        onSubmittingChange(false);
        setIsSubmitting(false);
      }
    }
  };

  const onSubmit = async (values: TaskCreateValues) => {
    if (
      checklistDrafts.some((item) => item.title.trim() !== '' && item.title.trim().length > 255)
    ) {
      setFormError('Checklist item titles must be 255 characters or fewer.');
      return;
    }
    const payload: CreateTaskPayload = { title: values.title };
    if (values.description) payload.description = values.description;
    if (values.priority) payload.priority = values.priority;
    if (values.dueDate) payload.dueDate = values.dueDate;
    const checklist = checklistDrafts.flatMap((item) => {
      const title = item.title.trim();
      if (!title) return [];
      return [{ title, ...(item.dueDate ? { dueDate: item.dueDate } : {}) }];
    });
    if (checklist.length > 0) payload.checklist = checklist;
    const snapshot: TaskCreateRecovery = {
      payload,
      requestKey: globalThis.crypto.randomUUID(),
      ownerId: userId,
    };
    setRecovery(null);
    await send(snapshot);
  };

  const retry = () => {
    if (recovery) void send(recovery);
  };

  const cancel = () => {
    if (submitting.current) return;
    cancelled.current = true;
    onDirtyChange(false);
    onCancel();
  };

  const fieldsDisabled = isSubmitting || recovery !== null;
  const fieldError = (name: keyof TaskCreateInput) => {
    const message = form.formState.errors[name]?.message;
    return typeof message === 'string' ? message : undefined;
  };

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void form.handleSubmit(onSubmit)(event);
  };

  return (
    <form onSubmit={handleFormSubmit} noValidate className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-6">
        <div className="space-y-2">
          <label htmlFor="task-create-title" className="text-sm font-medium text-foreground">
            Title
          </label>
          <Input
            id="task-create-title"
            maxLength={255}
            aria-invalid={Boolean(fieldError('title'))}
            aria-describedby={fieldError('title') ? 'task-create-title-error' : undefined}
            disabled={fieldsDisabled}
            {...titleField}
            ref={(element) => {
              titleField.ref(element);
              titleInputRef.current = element;
            }}
            onChange={(event) => {
              void titleField.onChange(event);
              reportDirtyFromCurrentValues();
            }}
          />
          {fieldError('title') && (
            <p id="task-create-title-error" className="text-sm text-destructive">
              {fieldError('title')}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="task-create-description-editor"
            className="text-sm font-medium text-foreground"
          >
            Description (optional)
          </label>
          <RichTextEditor
            value={form.getValues('description')}
            onChange={(description) => {
              form.setValue('description', description, {
                shouldDirty: true,
                shouldTouch: true,
                shouldValidate: true,
              });
              reportDirtyFromCurrentValues();
            }}
            ariaLabel="Description (optional)"
            id="task-create-description-editor"
            disabled={fieldsDisabled}
          />
          {fieldError('description') && (
            <p id="task-create-description-error" className="text-sm text-destructive">
              {fieldError('description')}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="task-create-priority" className="text-sm font-medium text-foreground">
            Priority (optional)
          </label>
          <select
            id="task-create-priority"
            aria-invalid={Boolean(fieldError('priority'))}
            aria-describedby={fieldError('priority') ? 'task-create-priority-error' : undefined}
            disabled={fieldsDisabled}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            {...priorityField}
            onChange={(event) => {
              void priorityField.onChange(event);
              reportDirtyFromCurrentValues();
            }}
          >
            <option value="">No priority</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          {fieldError('priority') && (
            <p id="task-create-priority-error" className="text-sm text-destructive">
              {fieldError('priority')}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="task-create-due-date" className="text-sm font-medium text-foreground">
            Due date (optional)
          </label>
          <Input
            id="task-create-due-date"
            type="date"
            aria-invalid={Boolean(fieldError('dueDate'))}
            aria-describedby={fieldError('dueDate') ? 'task-create-due-date-error' : undefined}
            disabled={fieldsDisabled}
            {...dueDateField}
            onChange={(event) => {
              void dueDateField.onChange(event);
              reportDirtyFromCurrentValues();
            }}
          />
          {fieldError('dueDate') && (
            <p id="task-create-due-date-error" className="text-sm text-destructive">
              {fieldError('dueDate')}
            </p>
          )}
        </div>

        <TaskCreateChecklist
          items={checklistDrafts}
          onChange={handleChecklistDraftChange}
          disabled={fieldsDisabled}
        />

        {formError && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {formError}
          </p>
        )}
      </div>

      <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
        <Button type="button" variant="outline" onClick={cancel} disabled={isSubmitting}>
          Cancel
        </Button>
        {recovery ? (
          <Button type="button" onClick={retry} disabled={isSubmitting}>
            {isSubmitting ? 'Retrying…' : 'Retry creation'}
          </Button>
        ) : (
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create'}
          </Button>
        )}
      </footer>
    </form>
  );
}
