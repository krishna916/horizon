import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/inbox')({
  component: InboxPlaceholder,
})

function InboxPlaceholder() {
  return (
    <div className="p-8">
      <h2 className="text-2xl font-semibold mb-4 text-foreground">Inbox</h2>
      <p className="text-muted-foreground">Inbox review (Placeholder)</p>
    </div>
  )
}
