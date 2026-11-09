import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { NotesBrowseProvider, useNotesBrowse } from './NotesBrowseContext';

function BrowseProbe() {
  const { state, setCollection, setSort, setView, rememberScroll } = useNotesBrowse();
  return (
    <div>
      <output data-testid="browse-state">
        {`${state.collection}:${state.sort}:${state.view}:${state.scrollTop}`}
      </output>
      <button onClick={() => setCollection('archived')}>Archived</button>
      <button onClick={() => setSort('title_asc')}>Title sort</button>
      <button onClick={() => setView('list')}>List view</button>
      <button onClick={() => rememberScroll(850)}>Remember scroll</button>
    </div>
  );
}

function MountableProbe() {
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button onClick={() => setMounted((current) => !current)}>Toggle workspace</button>
      {mounted && <BrowseProbe />}
    </>
  );
}

function SessionHarness({ userId, children }: { userId: number; children?: ReactNode }) {
  return <NotesBrowseProvider userId={userId}>{children ?? <BrowseProbe />}</NotesBrowseProvider>;
}

describe('Notes browse context', () => {
  afterEach(() => localStorage.clear());

  it('retains collection, sort, view, and scroll while the workspace child remounts', () => {
    render(
      <NotesBrowseProvider userId={1}>
        <MountableProbe />
      </NotesBrowseProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    fireEvent.click(screen.getByRole('button', { name: 'Title sort' }));
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remember scroll' }));
    expect(screen.getByTestId('browse-state')).toHaveTextContent('archived:title_asc:list:850');

    fireEvent.click(screen.getByRole('button', { name: 'Toggle workspace' }));
    expect(screen.queryByTestId('browse-state')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle workspace' }));

    expect(screen.getByTestId('browse-state')).toHaveTextContent('archived:title_asc:list:850');
  });

  it('isolates owners and restores only the view preference in a new visit', () => {
    const view = render(<SessionHarness userId={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    fireEvent.click(screen.getByRole('button', { name: 'Title sort' }));
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remember scroll' }));
    expect(localStorage.getItem('horizon:notes:view:1')).toBe('list');
    expect(localStorage.getItem('horizon:notes:view:2')).toBeNull();

    view.rerender(<SessionHarness key={2} userId={2} />);
    expect(screen.getByTestId('browse-state')).toHaveTextContent('active:updated_desc:cards:0');

    view.rerender(<SessionHarness key={1} userId={1} />);
    expect(screen.getByTestId('browse-state')).toHaveTextContent('active:updated_desc:list:0');

    view.unmount();
    render(<SessionHarness userId={1} />);
    expect(screen.getByTestId('browse-state')).toHaveTextContent('active:updated_desc:list:0');
    expect(localStorage.getItem('horizon:notes:view:1')).toBe('list');
    expect(localStorage.getItem('horizon:notes:view:2')).toBeNull();
  });
});
