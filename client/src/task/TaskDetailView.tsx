import { useEffect, useRef, useState } from 'react';
import { useTaskFieldEdit } from './useTaskFieldEdit';
import { TaskFieldEditor } from './TaskFieldEditor';
import type { TaskDetail } from './types';
import { TaskDescriptionField } from './TaskDescriptionField';
import { useTaskDescriptionEdit } from './useTaskDescriptionEdit';
import {
  normalizeRichTextDocument,
  type RichTextDocument,
} from '@/components/rich-text/richTextDocument';
import { useTaskDraftGuard } from './TaskDraftNavigationGuard';
import { useTaskCompletion } from './TaskCompletionProvider';
import { TaskCompletionToggle } from './TaskCompletionToggle';
import { TaskCompletionFeedback } from './TaskCompletionFeedback';
import { ChecklistSection } from './ChecklistSection';
import { TaskCompletionGateControls, useTaskCompletionGate } from './TaskCompletionGate';

interface TaskDetailViewProps {
  readonly task: TaskDetail;
  readonly userId: number;
  readonly onCompletionIntent?: (taskId: number, completed: boolean) => void;
}

export function TaskDetailView({ task, userId, onCompletionIntent }: TaskDetailViewProps) {
  const description = normalizeRichTextDocument(task.description as RichTextDocument | null);
  const edit = useTaskFieldEdit(task, userId);
  const descriptionEdit = useTaskDescriptionEdit(task, userId);
  const draftGuard = useTaskDraftGuard();
  const completion = useTaskCompletion(userId, task);
  const [checklistEditing, setChecklistEditing] = useState(false);
  const gate = useTaskCompletionGate(userId, task, completion.completed, () => {
    const completed = completion.toggle();
    onCompletionIntent?.(task.id, completed);
  });
  const registerDraft = draftGuard?.register;
  const clearDraft = draftGuard?.clear;
  const saveRef = useRef<() => Promise<boolean>>(edit.save);
  const cancelRef = useRef<() => void>(edit.cancel);
  useEffect(() => {
    saveRef.current = descriptionEdit.editing ? descriptionEdit.save : edit.save;
    cancelRef.current = descriptionEdit.editing ? descriptionEdit.cancel : edit.cancel;
  });
  const fieldId = edit.activeField
    ? `field:${userId}:${task.id}:${edit.activeField}`
    : descriptionEdit.editing
      ? `field:${userId}:${task.id}:description`
      : null;
  const activeDirty = descriptionEdit.editing ? descriptionEdit.dirty : edit.dirty;
  const activePending = descriptionEdit.editing ? descriptionEdit.pending : edit.pending;
  useEffect(() => {
    if (!fieldId) return;
    registerDraft?.({
      id: fieldId,
      kind: 'field',
      dirty: activeDirty,
      pending: activePending,
      save: () => saveRef.current(),
      discard: () => cancelRef.current(),
    });
  }, [registerDraft, fieldId, activeDirty, activePending]);
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
      if (!checklistEditing && !descriptionEdit.editing && !descriptionEdit.pending) {
        edit.activate(field);
      }
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
            onToggle={gate.requestToggle}
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
            onToggle={gate.requestToggle}
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
      <TaskDescriptionField
        value={description}
        editing={descriptionEdit.editing}
        draft={descriptionEdit.draft}
        dirty={descriptionEdit.dirty}
        pending={descriptionEdit.pending}
        blocked={Boolean(edit.activeField) || edit.pending || checklistEditing}
        error={descriptionEdit.error}
        onActivate={() => {
          if (!edit.activeField && !edit.pending && !checklistEditing) descriptionEdit.activate();
        }}
        onChange={descriptionEdit.change}
        onSave={() => void descriptionEdit.save()}
        onCancel={descriptionEdit.cancel}
      />
      <ChecklistSection
        taskId={task.id}
        userId={userId}
        items={task.checklist}
        editBlocked={
          Boolean(edit.activeField) ||
          edit.pending ||
          descriptionEdit.editing ||
          descriptionEdit.pending
        }
        onEditSessionChange={setChecklistEditing}
      />
      <TaskCompletionGateControls taskKey={task.key} gate={gate} />
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
