import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { tagApi } from './api';
import type { Tag, TagSelection } from './types';

export interface TagSelectorProps {
  readonly value: TagSelection[];
  readonly onChange: (next: TagSelection[]) => void;
  readonly userId: number;
  readonly knownTags?: Tag[];
  readonly disabled?: boolean;
  readonly createLabel?: 'create' | 'add';
}

function normalizedName(name: string) {
  return name.trim().toLowerCase();
}

function getActiveSelection(
  activeIndex: number,
  visibleSuggestions: Tag[],
  showCreate: boolean,
  createName: string
): TagSelection | null {
  if (activeIndex >= 0 && activeIndex < visibleSuggestions.length) {
    const tag = visibleSuggestions[activeIndex];
    return tag ? { id: tag.id } : null;
  }
  if (showCreate && (activeIndex === visibleSuggestions.length || activeIndex < 0)) {
    return { name: createName };
  }
  if (!showCreate && visibleSuggestions.length === 1) {
    const tag = visibleSuggestions[0];
    return tag ? { id: tag.id } : null;
  }
  return null;
}

export function TagSelector({
  value,
  onChange,
  userId,
  knownTags = [],
  disabled = false,
  createLabel = 'create',
}: TagSelectorProps): React.JSX.Element {
  const id = useId();
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [resolvedTags, setResolvedTags] = useState<{ ownerId: number; tag: Tag }[]>([]);
  const selectorRef = useRef<HTMLDivElement>(null);
  const prefix = query.trim();
  const suggestionsQuery = useQuery({
    queryKey: ['tags', 'suggestions', userId, prefix],
    queryFn: async () => (await tagApi.suggest(prefix)).data.items,
    enabled: !disabled && isOpen && prefix.length > 0,
    staleTime: 30_000,
    retry: false,
  });
  const tagsById = useMemo(() => {
    const tags = new Map<number, Tag>();
    const resolvedForOwner = resolvedTags
      .filter((entry) => entry.ownerId === userId)
      .map((entry) => entry.tag);
    for (const tag of [...knownTags, ...resolvedForOwner, ...(suggestionsQuery.data ?? [])]) {
      tags.set(tag.id, tag);
    }
    return tags;
  }, [knownTags, resolvedTags, suggestionsQuery.data, userId]);
  const displaySelections = value
    .map((selection, index) => {
      let name: string;
      if ('name' in selection) {
        name = selection.name;
      } else {
        name = tagsById.get(selection.id)?.name ?? `Tag #${selection.id}`;
      }

      return { selection, index, name };
    })
    .sort((left, right) => {
      const byNormalizedName = left.name.toLowerCase().localeCompare(right.name.toLowerCase());
      if (byNormalizedName !== 0) return byNormalizedName;
      let byDisplayName = 0;
      if (left.name < right.name) {
        byDisplayName = -1;
      } else if (left.name > right.name) {
        byDisplayName = 1;
      }
      if (byDisplayName !== 0) return byDisplayName;
      const leftId = 'id' in left.selection ? left.selection.id : Number.MAX_SAFE_INTEGER;
      const rightId = 'id' in right.selection ? right.selection.id : Number.MAX_SAFE_INTEGER;
      return leftId - rightId || left.index - right.index;
    });
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
  const isSuggestionsOpen = !disabled && isOpen && prefix.length > 0;
  const listboxId = `${id}-listbox`;
  const activeOptionIndex = activeIndex >= 0 && activeIndex < optionCount ? activeIndex : -1;

  useEffect(() => {
    if (!isSuggestionsOpen) return;
    const dismissWhenPointerLeaves = (event: PointerEvent) => {
      if (event.target instanceof Node && selectorRef.current?.contains(event.target)) return;
      setIsOpen(false);
      setActiveIndex(-1);
    };
    document.addEventListener('pointerdown', dismissWhenPointerLeaves);
    return () => document.removeEventListener('pointerdown', dismissWhenPointerLeaves);
  }, [isSuggestionsOpen]);

  const select = (selection: TagSelection) => {
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
      setActiveIndex((activeOptionIndex + 1) % optionCount);
      return;
    }
    if (event.key === 'ArrowUp' && optionCount > 0) {
      event.preventDefault();
      setActiveIndex(activeOptionIndex <= 0 ? optionCount - 1 : activeOptionIndex - 1);
      return;
    }
    if (event.key === 'Enter' && isSuggestionsOpen) {
      event.preventDefault();
      const selection = getActiveSelection(
        activeOptionIndex,
        visibleSuggestions,
        showCreate,
        createName
      );
      if (selection) select(selection);
      return;
    }
    if (event.key === 'Escape') {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div
      ref={selectorRef}
      className="space-y-2"
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        setIsOpen(false);
        setActiveIndex(-1);
      }}
    >
      <label htmlFor={`${id}-input`} className="text-sm font-medium text-foreground">
        Tags
      </label>
      <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        {displaySelections.map(({ selection, index, name }) => {
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
          aria-expanded={isSuggestionsOpen}
          aria-controls={listboxId}
          aria-activedescendant={
            activeOptionIndex >= 0 && isSuggestionsOpen
              ? `${id}-option-${activeOptionIndex}`
              : undefined
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

      {isSuggestionsOpen && (
        <div className="overflow-hidden rounded-md border border-border bg-background text-sm shadow-sm">
          <div id={listboxId} role="listbox" aria-label="Tag suggestions">
            {visibleSuggestions.map((tag, index) => (
              <button
                key={tag.id}
                id={`${id}-option-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={activeOptionIndex === index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select({ id: tag.id })}
                className="w-full px-3 py-2 text-left text-foreground hover:bg-muted focus-visible:outline-none focus-visible:bg-muted"
              >
                {tag.name}
              </button>
            ))}
            {showCreate && (
              <button
                id={`${id}-option-${visibleSuggestions.length}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={activeOptionIndex === visibleSuggestions.length}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select({ name: createName })}
                className="w-full border-t border-border px-3 py-2 text-left font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:bg-muted"
              >
                {createLabel === 'add' ? 'Add tag' : 'Create tag'} “{createName}”
              </button>
            )}
          </div>
          {suggestionsQuery.isLoading && (
            <output className="block px-3 py-2 text-muted-foreground">Loading tags…</output>
          )}
          {suggestionsQuery.isError && (
            <p role="alert" className="px-3 py-2 text-destructive">
              Could not load tags. Try again.
            </p>
          )}
          {!suggestionsQuery.isLoading &&
            !suggestionsQuery.isError &&
            visibleSuggestions.length === 0 && (
              <output className="block px-3 py-2 text-muted-foreground">No matching tags</output>
            )}
        </div>
      )}
    </div>
  );
}

function isDuplicate(
  candidate: TagSelection,
  current: TagSelection[],
  tagsById: Map<number, Tag>
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
