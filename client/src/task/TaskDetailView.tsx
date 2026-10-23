import { useEffect, useRef, useState } from 'react';
import { useTaskFieldEdit } from './useTaskFieldEdit';
import { TaskFieldEditor } from './TaskFieldEditor';
import type { TaskDetail } from './types';
import { getTaskDescriptionText } from './taskDescriptionText';
import { useTaskDraftGuard } from './TaskDraftNavigationGuard';
import { useTaskCompletion } from './TaskCompletionProvider';
import { TaskCompletionToggle } from './TaskCompletionToggle';
import { TaskCompletionFeedback } from './TaskCompletionFeedback';
import { ChecklistSection } from './ChecklistSection';

interface TaskDetailViewProps {
  readonly task: TaskDetail;
  readonly userId: number;
  readonly onCompletionIntent?: (taskId: number, completed: boolean) => void;
}

export function TaskDetailView({ task, userId, onCompletionIntent }: TaskDetailViewProps) {
  const description = getTaskDescriptionText(task.description);
  const edit = useTaskFieldEdit(task, userId);
  const draftGuard = useTaskDraftGuard();
  const completion = useTaskCompletion(userId, task);
  const [checklistEditing, setChecklistEditing] = useState(false);
  const toggleCompletion = () => {
    const completed = completion.toggle();
    onCompletionIntent?.(task.id, completed);
  };
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
    completed: completion.completed,
    activeField: edit.activeField,
    draft: edit.draft,
    dirty: edit.dirty,
    pending: edit.pending,
    error: edit.error,
    onActivate: (field: 'title' | 'priority' | 'dueDate') => {
      if (!checklistEditing) edit.activate(field);
    },
    onDraftChange: edit.setDraft,
    onSave: () => void edit.save(),
    onCancel: edit.cancel,
  };

  return (
    <div className="space-y-6 px-6 py-7">
      {edit.activeField === 'title' ? (
        <div
          role="heading"
          aria-level={1}
          aria-label={task.title}
          className="mt-[32px] mb-[32px] flex items-start gap-3 max-[1024px]:mt-[20px] max-[1024px]:mb-[20px] font-[family-name:var(--heading)] tracking-[-1.68px]"
        >
          <TaskCompletionToggle
            taskKey={task.key}
            completed={completion.completed}
            onToggle={toggleCompletion}
          />
          <div className="min-w-0 flex-1">
            <TaskFieldEditor field="title" value={task.title} {...editorProps} />
            <TaskCompletionFeedback
              taskKey={task.key}
              saving={completion.saving}
              error={completion.error}
              onRetry={completion.retry}
            />
          </div>
        </div>
      ) : (
        <h1 aria-label={task.title} className="flex items-start gap-3">
          <TaskCompletionToggle
            taskKey={task.key}
            completed={completion.completed}
            onToggle={toggleCompletion}
          />
          <div className="min-w-0 flex-1">
            <TaskFieldEditor field="title" value={task.title} {...editorProps} />
            <TaskCompletionFeedback
              taskKey={task.key}
              saving={completion.saving}
              error={completion.error}
              onRetry={completion.retry}
            />
          </div>
        </h1>
      )}
      {description && (
        <p className="break-words whitespace-pre-wrap text-base leading-7 text-muted-foreground">
          {description}
        </p>
      )}
      <ChecklistSection
        taskId={task.id}
        userId={userId}
        items={task.checklist}
        editBlocked={Boolean(edit.activeField) || edit.pending}
        onEditSessionChange={setChecklistEditing}
      />
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
