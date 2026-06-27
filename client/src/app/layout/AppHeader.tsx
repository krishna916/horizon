import { useLocation } from '@tanstack/react-router'
import { Search, Bell, HelpCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'

export function AppHeader() {
  const location = useLocation()

  const getTitle = (pathname: string) => {
    switch (pathname) {
      case '/':
        return 'Home'
      case '/today':
        return 'Today'
      case '/inbox':
        return 'Inbox'
      case '/tasks':
        return 'Tasks'
      case '/notes':
        return 'Notes'
      case '/settings':
        return 'Settings'
      default:
        return 'Horizon'
    }
  }

  const title = getTitle(location.pathname)

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-background px-8">
      <div className="flex items-center gap-8">
        <h2 className="text-xl font-semibold tracking-tight text-foreground m-0 p-0 select-none">
          {title}
        </h2>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={`Search ${title.toLowerCase()}...`}
            className="pl-9 h-9 w-full bg-muted/30 border-border"
          />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </button>
        <button
          type="button"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          aria-label="Help"
        >
          <HelpCircle className="h-5 w-5" />
        </button>
      </div>
    </header>
  )
}
