export function NoteNewPlaceholder({ onBack }: { readonly onBack: () => void }) {
  return (
    <section
      className="mx-auto w-full max-w-3xl p-6 sm:p-8 lg:p-10"
      aria-labelledby="note-new-heading"
    >
      <h1 id="note-new-heading" className="text-3xl font-medium text-foreground">
        Note editor coming next
      </h1>
      <p className="mt-4 text-sm text-muted-foreground">
        You’ll be able to create and edit notes here in a future update.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="mt-8 inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to Notes
      </button>
    </section>
  );
}
