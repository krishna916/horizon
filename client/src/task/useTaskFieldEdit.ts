import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';
import { useUpdateTask } from './useUpdateTask';
import type { TaskDetail, TaskPriority, UpdateTaskPayload } from './types';

export type TaskFieldName = 'title' | 'priority' | 'dueDate';

interface TaskFieldEditState {
  activeField: TaskFieldName | null;
  draft: string;
  dirty: boolean;
  pending: boolean;
  error: string | null;
  activate: (field: TaskFieldName) => void;
  setDraft: (value: string) => void;
  save: () => Promise<boolean>;
  cancel: () => void;
}

const priorities: readonly TaskPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function fieldValue(task: TaskDetail, field: TaskFieldName): string {
  return task[field] ?? '';
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function getServerError(error: unknown, field: TaskFieldName): string | null {
  if (!isAxiosError(error)) return null;
  const data = error.response?.data;
  if (!data || typeof data !== 'object' || !('errors' in data)) return null;
  const errors = data.errors;
  if (!errors || typeof errors !== 'object') return null;
  const fieldError = (errors as Record<string, unknown>)[field];
  if (typeof fieldError === 'string') return fieldError;
  if (Array.isArray(fieldError) && typeof fieldError[0] === 'string') return fieldError[0];
  return null;
}

export function useTaskFieldEdit(task: TaskDetail, userId: number): TaskFieldEditState {
  const [activeField, setActiveField] = useState<TaskFieldName | null>(null);
  const [draft, setDraftValue] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const identityRef = useRef({ taskId: task.id, userId });
  const { updateTask } = useUpdateTask(userId);
  const originalValue = activeField ? fieldValue(task, activeField) : '';
  const dirty = activeField !== null && draft !== originalValue;

  useEffect(() => {
    const identity = identityRef.current;
    if (identity.taskId !== task.id || identity.userId !== userId) {
      identityRef.current = { taskId: task.id, userId };
      setActiveField(null);
      setDraftValue('');
      setError(null);
    }
  }, [task.id, userId]);

  function activate(field: TaskFieldName) {
    if (pendingRef.current || (dirty && activeField !== field)) return;
    setError(null);
    if (activeField !== field) setDraftValue(fieldValue(task, field));
    setActiveField(field);
  }

  function setDraft(value: string) {
    if (pendingRef.current || activeField === null) return;
    setDraftValue(value);
    setError(null);
  }

  async function save(): Promise<boolean> {
    if (pendingRef.current) return false;
    if (activeField === null) return true;
    if (!dirty) {
      setActiveField(null);
      return true;
    }

    let patch: UpdateTaskPayload;
    switch (activeField) {
      case 'title': {
        const title = draft.trim();
        if (!title) {
          setError('A title is required.');
          return false;
        }
        if (title.length > 255) {
          setError('Title must be 255 characters or fewer.');
          return false;
        }
        patch = { title };
        break;
      }
      case 'priority':
        if (draft !== '' && !priorities.includes(draft as TaskPriority)) {
          setError('Choose a valid priority.');
          return false;
        }
        patch = { priority: draft === '' ? null : (draft as TaskPriority) };
        break;
      case 'dueDate':
        if (draft !== '' && !isValidDate(draft)) {
          setError('Enter a valid due date.');
          return false;
        }
        patch = { dueDate: draft === '' ? null : draft };
        break;
    }

    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await updateTask(task.id, patch);
      setActiveField(null);
      setDraftValue(fieldValue(task, activeField));
      return true;
    } catch (saveError) {
      setError(
        getServerError(saveError, activeField) ??
          'Could not save this field. Your draft is still here. Try again.'
      );
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function cancel() {
    if (pendingRef.current) return;
    if (activeField) setDraftValue(fieldValue(task, activeField));
    setActiveField(null);
    setError(null);
  }

  return { activeField, draft, dirty, pending, error, activate, setDraft, save, cancel };
}
