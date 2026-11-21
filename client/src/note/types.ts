import type { RichTextDocument } from '@/components/rich-text/richTextDocument';
import type { Tag, TagSelection } from '@/tag/types';

export type NoteCollection = 'active' | 'archived';
export type NoteSort = 'updated_desc' | 'updated_asc' | 'title_asc';
export type NoteViewMode = 'cards' | 'list';

export interface NoteSummary {
  id: number;
  title: string | null;
  preview: RichTextDocument | null;
  tags: Tag[];
  version: number;
  inbox: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDetail extends Omit<NoteSummary, 'preview'> {
  content: RichTextDocument | null;
}

export interface CreateNoteRequest {
  title: string | null;
  content: RichTextDocument | null;
  tags: TagSelection[];
}

export interface UpdateNoteRequest {
  expectedVersion: number;
  title?: string | null;
  content?: RichTextDocument | null;
  tags?: TagSelection[];
}

export interface NoteListResponse {
  items: NoteSummary[];
  page: number;
  size: number;
  hasNext: boolean;
  counts: { active: number; archived: number };
}

export type NoteLifecycleOperation = 'archive' | 'restore' | 'delete';

export type NoteLifecycleTarget = Pick<NoteSummary, 'id' | 'version' | 'archivedAt'>;

export interface NoteDeletionReceipt {
  id: number;
  version: number;
}

export type NoteLifecycleResult =
  { kind: 'note'; note: NoteDetail } | { kind: 'deleted'; receipt: NoteDeletionReceipt };
