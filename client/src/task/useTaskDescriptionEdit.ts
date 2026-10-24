import { useEffect, useRef, useState } from 'react';
import {
  normalizeRichTextDocument,
  type RichTextDocument,
} from '@/components/rich-text/richTextDocument';
import { useUpdateTask } from './useUpdateTask';
import type { TaskDetail } from './types';

function normalize(value: Record<string, unknown> | null): RichTextDocument | null {
  return normalizeRichTextDocument(value as RichTextDocument | null);
}

function serialize(value: RichTextDocument | null): string {
  return JSON.stringify(value);
}

export function useTaskDescriptionEdit(task: TaskDetail, userId: number) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RichTextDocument | null>(null);
  const [baseline, setBaseline] = useState(() => serialize(normalize(task.description)));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const identityRef = useRef({ taskId: task.id, userId });
  const generationRef = useRef(0);
  const { updateTask } = useUpdateTask(userId);
  const dirty = editing && serialize(draft) !== baseline;

  useEffect(() => {
    if (identityRef.current.taskId === task.id && identityRef.current.userId === userId) return;
    identityRef.current = { taskId: task.id, userId };
    generationRef.current += 1;
    pendingRef.current = false;
    setBaseline(serialize(normalize(task.description)));
    setEditing(false);
    setDraft(null);
    setPending(false);
    setError(null);
  }, [task.description, task.id, userId]);

  function activate() {
    if (pendingRef.current) return;
    setBaseline(serialize(normalize(task.description)));
    setDraft(normalize(task.description));
    setError(null);
    setEditing(true);
  }

  function change(value: RichTextDocument | null) {
    if (!editing || pendingRef.current) return;
    setDraft(normalize(value));
    setError(null);
  }

  async function save(): Promise<boolean> {
    if (pendingRef.current) return false;
    if (!editing || !dirty) {
      setEditing(false);
      return true;
    }
    const generation = generationRef.current;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const updated = await updateTask(task.id, { description: draft });
      if (generationRef.current === generation) {
        const saved = normalize(updated.description);
        setBaseline(serialize(saved));
        setDraft(saved);
        setEditing(false);
      }
      return true;
    } catch {
      if (generationRef.current === generation) {
        setError('Could not save this description. Your draft is still here. Try again.');
      }
      return false;
    } finally {
      if (generationRef.current === generation) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  }

  function cancel() {
    if (pendingRef.current) return;
    setBaseline(serialize(normalize(task.description)));
    setDraft(null);
    setEditing(false);
    setError(null);
  }

  return { editing, draft, dirty, pending, error, activate, change, save, cancel };
}
