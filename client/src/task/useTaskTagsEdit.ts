import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';
import { useUpdateTask } from './useUpdateTask';
import type { TaskDetail, TaskTagSelection } from './types';

export interface TaskTagsEditState {
  editing: boolean;
  draft: TaskTagSelection[];
  dirty: boolean;
  pending: boolean;
  error: string | null;
  activate: () => void;
  change: (next: TaskTagSelection[]) => void;
  save: () => Promise<boolean>;
  cancel: () => void;
}

function taskSelections(task: TaskDetail): TaskTagSelection[] {
  return task.tags.map((tag) => ({ id: tag.id }));
}

function selectionKey(selection: TaskTagSelection): string {
  return JSON.stringify('id' in selection ? ['id', selection.id] : ['name', selection.name]);
}

function sameSelectionSet(left: TaskTagSelection[], right: TaskTagSelection[]) {
  const leftKeys = left.map(selectionKey).sort();
  const rightKeys = right.map(selectionKey).sort();
  return JSON.stringify(leftKeys) === JSON.stringify(rightKeys);
}

function tagServerError(error: unknown): string | null {
  if (!isAxiosError(error)) return null;
  const data = error.response?.data;
  if (!data || typeof data !== 'object' || !('errors' in data)) return null;
  const errors = data.errors;
  if (!errors || typeof errors !== 'object') return null;
  const tagError = (errors as Record<string, unknown>).tags;
  if (typeof tagError === 'string') return tagError;
  if (Array.isArray(tagError) && typeof tagError[0] === 'string') return tagError[0];
  return null;
}

export function useTaskTagsEdit(task: TaskDetail, userId: number): TaskTagsEditState {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TaskTagSelection[]>(() => taskSelections(task));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const identityRef = useRef({ taskId: task.id, userId });
  const { updateTask } = useUpdateTask(userId);
  const dirty = editing && !sameSelectionSet(draft, taskSelections(task));

  useEffect(() => {
    if (identityRef.current.taskId !== task.id || identityRef.current.userId !== userId) {
      identityRef.current = { taskId: task.id, userId };
      setEditing(false);
      setDraft(taskSelections(task));
      setError(null);
    }
  }, [task, task.id, userId]);

  function activate() {
    if (pendingRef.current) return;
    setDraft(taskSelections(task));
    setError(null);
    setEditing(true);
  }

  function change(next: TaskTagSelection[]) {
    if (pendingRef.current || !editing) return;
    setDraft(next);
    setError(null);
  }

  async function save(): Promise<boolean> {
    if (pendingRef.current) return false;
    if (!editing) return true;
    if (!dirty) {
      setEditing(false);
      return true;
    }

    const identity = { taskId: task.id, userId };
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await updateTask(task.id, { tags: draft });
      if (
        identityRef.current.taskId === identity.taskId &&
        identityRef.current.userId === identity.userId
      ) {
        setEditing(false);
      }
      return true;
    } catch (saveError) {
      if (
        identityRef.current.taskId === identity.taskId &&
        identityRef.current.userId === identity.userId
      ) {
        setError(
          tagServerError(saveError) ?? 'Could not save tags. Your draft is still here. Try again.'
        );
      }
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function cancel() {
    if (pendingRef.current) return;
    setDraft(taskSelections(task));
    setEditing(false);
    setError(null);
  }

  return { editing, draft, dirty, pending, error, activate, change, save, cancel };
}
