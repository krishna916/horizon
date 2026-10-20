import { useEffect, useRef } from 'react';
import { useTaskFieldEdit } from './useTaskFieldEdit';
import { TaskFieldEditor } from './TaskFieldEditor';
import type { TaskDetail } from './types';
import { getTaskDescriptionText } from './taskDescriptionText';
import { useTaskDraftGuard } from './TaskDraftNavigationGuard';

interface TaskDetailViewProps {
  readonly task: TaskDetail;
  readonly userId: number;
}

export function TaskDetailView({ task, userId }: TaskDetailViewProps) {
  const description = getTaskDescriptionText(task.description);
  const edit = useTaskFieldEdit(task, userId);
  const draftGuard = useTaskDraftGuard();
  const registerDraft = draftGuard?.register;
  const clearDraft = draftGuard?.clear;
  const saveRef = useRef(edit.save);
  const cancelRef = useRef(edit.cancel);
  useEffect(() => {
    saveRef.current = edit.save;
    cancelRef.current = edit.cancel;
  });
  const fieldId = edit.activeField ? `field:${userId}:${task.id}:${edit.activeField}` : null;
  useEffect(() => {
    if (!fieldId) return;
    registerDraft?.({
      id: fieldId,
      kind: 'field',
      dirty: edit.dirty,
      pending: edit.pending,
      save: () => saveRef.current(),
      discard: () => cancelRef.current(),
    });
  }, [registerDraft, fieldId, edit.dirty, edit.pending]);
  useEffect(() => {
    if (!fieldId) return;
    return () => clearDraft?.(fieldId);
  }, [clearDraft, fieldId]);
  const editorProps = {
    activeField: edit.activeField,
    draft: edit.draft,
    dirty: edit.dirty,
    pending: edit.pending,
    error: edit.error,
    onActivate: edit.activate,
    onDraftChange: edit.setDraft,
    onSave: () => void edit.save(),
    onCancel: edit.cancel,
  };

  return (
    <div className="space-y-6 px-6 py-7">
      <h1>
        <TaskFieldEditor field="title" value={task.title} {...editorProps} />
      </h1>
      {description && (
        <p className="break-words whitespace-pre-wrap text-base leading-7 text-muted-foreground">
          {description}
        </p>
      )}
      <dl className="flex flex-wrap gap-x-6 gap-y-3 border-t border-border pt-5 text-sm">
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Priority</dt>
          <dd>
            <TaskFieldEditor field="priority" value={task.priority} {...editorProps} />
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Due date</dt>
          <dd>
            <TaskFieldEditor field="dueDate" value={task.dueDate} {...editorProps} />
          </dd>
        </div>
      </dl>
    </div>
  );
}
