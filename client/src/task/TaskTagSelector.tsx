import { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { tagApi } from '@/tag/api';
import type { TaskTag, TaskTagSelection } from './types';

interface TaskTagSelectorProps {
  readonly value: TaskTagSelection[];
  readonly onChange: (next: TaskTagSelection[]) => void;
  readonly userId: number;
  readonly knownTags?: TaskTag[];
  readonly disabled?: boolean;
}

function normalizedName(name: string) {
  return name.trim().toLowerCase();
}

export function TaskTagSelector({
  value,
  onChange,
  userId,
  knownTags = [],
  disabled = false,
}: TaskTagSelectorProps): React.JSX.Element {
  const id = useId();
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [resolvedTags, setResolvedTags] = useState<{ ownerId: number; tag: TaskTag }[]>([]);
  const prefix = query.trim();
  const suggestionsQuery = useQuery({
    queryKey: ['tags', 'suggestions', userId, prefix],
    queryFn: async () => (await tagApi.suggest(prefix)).data.items,
    enabled: !disabled && isOpen && prefix.length > 0,
    staleTime: 30_000,
    retry: false,
  });
  const tagsById = useMemo(() => {
    const tags = new Map<number, TaskTag>();
    const resolvedForOwner = resolvedTags
      .filter((entry) => entry.ownerId === userId)
      .map((entry) => entry.tag);
    for (const tag of [...knownTags, ...resolvedForOwner, ...(suggestionsQuery.data ?? [])]) {
      tags.set(tag.id, tag);
    }
    return tags;
  }, [knownTags, resolvedTags, suggestionsQuery.data, userId]);
  const visibleSuggestions = (suggestionsQuery.data ?? []).filter(
    (tag) => !isDuplicate({ id: tag.id }, value, tagsById)
  );
  const createName = query.trim();
  const showCreate =
    createName.length > 0 &&
    !suggestionsQuery.isLoading &&
    !suggestionsQuery.isError &&
    !(suggestionsQuery.data ?? []).some(
      (tag) => normalizedName(tag.name) === normalizedName(createName)
    ) &&
    !isDuplicate({ name: createName }, value, tagsById);
  const optionCount = visibleSuggestions.length + (showCreate ? 1 : 0);

  const select = (selection: TaskTagSelection) => {
    if (!isDuplicate(selection, value, tagsById)) {
      onChange([...value, selection]);
      if ('id' in selection) {
        const tag = tagsById.get(selection.id);
        if (tag) {
          setResolvedTags((current) => [
            ...current.filter((entry) => entry.ownerId !== userId || entry.tag.id !== selection.id),
            { ownerId: userId, tag },
          ]);
        }
      }
    }
    setQuery('');
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const remove = (index: number) => {
    onChange(value.filter((_, currentIndex) => currentIndex !== index));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && optionCount > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % optionCount);
    } else if (event.key === 'ArrowUp' && optionCount > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? optionCount - 1 : current - 1));
    } else if (event.key === 'Enter' && isOpen) {
      event.preventDefault();
      if (activeIndex >= 0 && activeIndex < visibleSuggestions.length) {
        const tag = visibleSuggestions[activeIndex];
        if (tag) select({ id: tag.id });
      } else if (activeIndex === visibleSuggestions.length && showCreate) {
        select({ name: createName });
      } else if (showCreate) {
        select({ name: createName });
      } else if (visibleSuggestions.length === 1) {
        const tag = visibleSuggestions[0];
        if (tag) select({ id: tag.id });
      }
    } else if (event.key === 'Escape') {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div className="space-y-2">
      <label htmlFor={`${id}-input`} className="text-sm font-medium text-foreground">
        Tags
      </label>
      <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        {value.map((selection, index) => {
          const name =
            'name' in selection
              ? selection.name
              : (tagsById.get(selection.id)?.name ?? `Tag #${selection.id}`);
          return (
            <span
              key={'name' in selection ? `name:${selection.name}:${index}` : `id:${selection.id}`}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-sm text-foreground"
            >
              {name}
              <button
                type="button"
                aria-label={`Remove tag ${name}`}
                disabled={disabled}
                onClick={() => remove(index)}
                className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </span>
          );
        })}
        <input
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-label="Add tags"
          aria-autocomplete="list"
          aria-expanded={isOpen && prefix.length > 0}
          aria-controls={`${id}-listbox`}
          aria-activedescendant={
            activeIndex >= 0 && isOpen ? `${id}-option-${activeIndex}` : undefined
          }
          autoComplete="off"
          disabled={disabled}
          value={query}
          onFocus={() => {
            if (prefix) setIsOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? 'Search or create a tag' : 'Add another tag'}
          className="min-w-28 flex-1 bg-transparent px-1 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
      </div>

      {isOpen && prefix.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border bg-background text-sm shadow-sm">
          {suggestionsQuery.isLoading && (
            <p role="status" className="px-3 py-2 text-muted-foreground">
              Loading tags…
            </p>
          )}
          {suggestionsQuery.isError && (
            <p role="alert" className="px-3 py-2 text-destructive">
              Could not load tags. Try again.
            </p>
          )}
          {!suggestionsQuery.isLoading &&
            !suggestionsQuery.isError &&
            visibleSuggestions.length === 0 && (
              <p className="px-3 py-2 text-muted-foreground">No matching tags</p>
            )}
          {(visibleSuggestions.length > 0 || showCreate) && (
            <ul id={`${id}-listbox`} role="listbox" aria-label="Tag suggestions">
              {visibleSuggestions.map((tag, index) => (
                <li key={tag.id} role="presentation">
                  <button
                    id={`${id}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={activeIndex === index}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => select({ id: tag.id })}
                    className="w-full px-3 py-2 text-left text-foreground hover:bg-muted focus-visible:outline-none focus-visible:bg-muted"
                  >
                    {tag.name}
                  </button>
                </li>
              ))}
              {showCreate && (
                <li role="presentation">
                  <button
                    id={`${id}-option-${visibleSuggestions.length}`}
                    type="button"
                    role="option"
                    aria-selected={activeIndex === visibleSuggestions.length}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => select({ name: createName })}
                    className="w-full border-t border-border px-3 py-2 text-left font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:bg-muted"
                  >
                    Create tag “{createName}”
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function isDuplicate(
  candidate: TaskTagSelection,
  current: TaskTagSelection[],
  tagsById: Map<number, TaskTag>
) {
  const candidateName = 'name' in candidate ? candidate.name : tagsById.get(candidate.id)?.name;
  return current.some((selection) => {
    if ('id' in candidate && 'id' in selection && selection.id === candidate.id) return true;
    if (candidateName === undefined) return false;
    const selectedName = 'name' in selection ? selection.name : tagsById.get(selection.id)?.name;
    return (
      selectedName !== undefined && normalizedName(selectedName) === normalizedName(candidateName)
    );
  });
}
