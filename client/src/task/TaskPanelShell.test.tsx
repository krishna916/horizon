import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TaskPanelShell } from './TaskPanelShell';

describe('TaskPanelShell', () => {
  it('provides a named detail region that contains its supplied content', () => {
    render(
      <TaskPanelShell>
        <p>Task details go here</p>
      </TaskPanelShell>
    );

    expect(screen.getByRole('region', { name: 'Task details' })).toContainElement(
      screen.getByText('Task details go here')
    );
  });
});
