import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/tasks')({
  component: TasksPlaceholder,
})

function TasksPlaceholder() {
  return (
    <div className="p-8">
      <h2 className="text-2xl font-semibold mb-4 text-foreground">Tasks</h2>
      <p className="text-muted-foreground">Tasks (Placeholder)</p>
    </div>
  )
}
