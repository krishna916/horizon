import type { RichTextDocument } from '@/components/rich-text/richTextDocument';

export type NoteCollection = 'active' | 'archived';
export type NoteSort = 'updated_desc' | 'updated_asc' | 'title_asc';
export type NoteViewMode = 'cards' | 'list';

export interface NoteSummary {
  id: number;
  title: string | null;
  preview: RichTextDocument | null;
  version: number;
  inbox: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDetail extends Omit<NoteSummary, 'preview'> {
  content: RichTextDocument | null;
}

export interface NoteListResponse {
  items: NoteSummary[];
  page: number;
  size: number;
  hasNext: boolean;
  counts: { active: number; archived: number };
}
