# ADR-002: Frontend UI Foundation

## Decision

Frontend UI stack:
- TailwindCSS
- shadcn/ui
- Radix UI
- Lucide React
- clsx
- tailwind-merge
- class-variance-authority

## Component Rules

### components/ui
Contains:
- shadcn generated components
- thin wrappers around shadcn components

No business logic allowed.

### components/shared
Contains:
- reusable Horizon-specific UI components

Examples:
- PageHeader
- EmptyState
- ConfirmationDialog

### features/*/components
Contains:
- domain-specific components

Examples:
- TaskCard
- TaskList
- GoalProgress
