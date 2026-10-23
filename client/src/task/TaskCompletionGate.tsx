/* eslint-disable react-refresh/only-export-components */
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { taskApi } from './api';
import type { TaskDetail, TaskSummary } from './types';

interface CompletionIntent {
  userId: number;
  taskId: number;
  taskKey: string;
  unfinishedCount: number;
}

export interface TaskCompletionGateState {
  readonly requestToggle: () => void;
  readonly checking: boolean;
  readonly error: string | null;
  readonly retry: () => void;
  readonly unfinishedCount: number | null;
  readonly confirm: () => void;
  readonly cancel: () => void;
}

export function TaskCompletionGateControls({
  taskKey,
  gate,
}: {
  readonly taskKey: string;
  readonly gate: TaskCompletionGateState;
}) {
  return (
    <>
      {gate.checking && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          Checking checklist…
        </p>
      )}
      {gate.error && (
        <div role="alert" className="mt-2 flex items-center gap-2 text-xs text-destructive">
          <span>{gate.error}</span>
          <button type="button" onClick={gate.retry} className="underline underline-offset-2">
            Retry checklist check
          </button>
        </div>
      )}
      <TaskCompletionGateDialog
        taskKey={taskKey}
        unfinishedCount={gate.unfinishedCount}
        onConfirm={gate.confirm}
        onCancel={gate.cancel}
      />
    </>
  );
}

export function useTaskCompletionGate(
  userId: number,
  task: TaskSummary,
  completed: boolean,
  proceed: () => void
): TaskCompletionGateState {
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<CompletionIntent | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const latest = useRef({ userId, task, completed, proceed });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
    };
  }, []);

  useEffect(() => {
    latest.current = { userId, task, completed, proceed };
  }, [completed, proceed, task, userId]);

  const requestToggle = useCallback(() => {
    const current = latest.current;
    const requestId = ++sequence.current;
    if (current.completed) {
      setChecking(false);
      setError(null);
      setConfirmation(null);
      current.proceed();
      return;
    }

    setChecking(true);
    setError(null);
    setConfirmation(null);
    void taskApi
      .get(current.task.id)
      .then(({ data }) => {
        if (!mounted.current || sequence.current !== requestId) return;
        const active = latest.current;
        if (active.userId !== current.userId || active.task.id !== current.task.id) return;
        queryClient.setQueryData(['tasks', current.userId, 'detail', current.task.id], data);
        setChecking(false);
        if (active.completed || data.completedAt !== null) return;
        const unfinishedCount = data.checklist.filter((item) => item.completedAt === null).length;
        if (unfinishedCount === 0) {
          active.proceed();
          return;
        }
        setConfirmation({
          userId: current.userId,
          taskId: current.task.id,
          taskKey: current.task.key,
          unfinishedCount,
        });
      })
      .catch(() => {
        if (!mounted.current || sequence.current !== requestId) return;
        setChecking(false);
        setError('Could not check checklist items.');
      });
  }, [queryClient]);

  const cancel = useCallback(() => {
    sequence.current += 1;
    setConfirmation(null);
  }, []);

  const confirm = useCallback(() => {
    const intent = confirmation;
    const current = latest.current;
    setConfirmation(null);
    if (
      !intent ||
      intent.userId !== current.userId ||
      intent.taskId !== current.task.id ||
      current.completed
    ) {
      return;
    }
    const detail = queryClient.getQueryData<TaskDetail>([
      'tasks',
      intent.userId,
      'detail',
      intent.taskId,
    ]);
    if (detail && detail.completedAt !== null) return;
    current.proceed();
  }, [confirmation, queryClient]);

  const visibleConfirmation =
    confirmation?.userId === userId && confirmation.taskId === task.id ? confirmation : null;

  return {
    requestToggle,
    checking,
    error,
    retry: requestToggle,
    unfinishedCount: visibleConfirmation?.unfinishedCount ?? null,
    confirm,
    cancel,
  };
}

export function TaskCompletionGateDialog({
  taskKey,
  unfinishedCount,
  onConfirm,
  onCancel,
}: {
  readonly taskKey: string;
  readonly unfinishedCount: number | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const open = unfinishedCount !== null;
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/45" />
        <Dialog.Content
          role="alertdialog"
          aria-describedby="task-completion-gate-description"
          className="fixed left-1/2 top-1/2 z-[101] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-xl outline-none"
        >
          <Dialog.Title className="text-base font-semibold text-foreground">
            Complete {taskKey} with unfinished items?
          </Dialog.Title>
          <Dialog.Description
            id="task-completion-gate-description"
            className="mt-2 text-sm text-muted-foreground"
          >
            {unfinishedCount === 1
              ? '1 checklist item is unfinished. You can still complete this task.'
              : `${unfinishedCount} checklist items are unfinished. You can still complete this task.`}
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel completion
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Complete Anyway
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
