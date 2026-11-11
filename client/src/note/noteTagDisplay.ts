import type { Tag } from '@/tag/types';

export function sortNoteTags(tags: Tag[]): Tag[] {
  return [...tags].sort((first, second) => {
    const firstNormalized = first.name.toLowerCase();
    const secondNormalized = second.name.toLowerCase();
    if (firstNormalized < secondNormalized) return -1;
    if (firstNormalized > secondNormalized) return 1;
    if (first.name < second.name) return -1;
    if (first.name > second.name) return 1;
    return first.id - second.id;
  });
}
