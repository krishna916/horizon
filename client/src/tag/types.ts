export interface Tag {
  id: number;
  name: string;
}

export type TagSelection = { id: number } | { name: string };
