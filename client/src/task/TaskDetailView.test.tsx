import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TaskDetail } from './types';
import { TaskDetailView } from './TaskDetailView';

const task: TaskDetail = {
  id: 7,
  key: 'TASK-7',
  title: 'Review the release notes',
  priority: 'HIGH',
  dueDate: '2026-10-25',
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-18T10:00:00Z',
  updatedAt: '2026-10-18T10:00:00Z',
  description: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Check the release notes.' }] }],
  },
  deletedAt: null,
};

describe('TaskDetailView', () => {
  it('renders supported task content and optional metadata without invented controls or sections', () => {
    render(<TaskDetailView task={task} />);

    expect(screen.getByRole('heading', { name: 'Review the release notes' })).toBeInTheDocument();
    expect(screen.getByText('Check the release notes.')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText(/Oct 25/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/checklist|tags|attachments|activity/i)).not.toBeInTheDocument();
  });

  it('omits empty description and absent optional metadata', () => {
    render(
      <TaskDetailView
        task={{ ...task, description: { type: 'doc', content: [] }, priority: null, dueDate: null }}
      />
    );

    expect(screen.getByRole('heading', { name: 'Review the release notes' })).toBeInTheDocument();
    expect(screen.queryByText('High')).not.toBeInTheDocument();
    expect(screen.queryByText(/Oct 25/)).not.toBeInTheDocument();
    expect(screen.queryByText('Check the release notes.')).not.toBeInTheDocument();
  });

  it('renders markup-like description as text, never as HTML', () => {
    render(
      <TaskDetailView
        task={{
          ...task,
          description: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] }],
          },
        }}
      />
    );

    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });
});
