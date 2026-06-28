import { Link, useNavigate, useLocation } from '@tanstack/react-router';
import { Home, Calendar, Inbox, CheckCircle, FileText, Settings, Plus, LogOut } from 'lucide-react';
import { useCurrentUser } from '@/user/hooks/useCurrentUser';
import { useLogoutUser } from '@/user/hooks/useLogoutUser';
import { cn } from '@/lib/utils';

export function AppSidebar() {
  const { data: user } = useCurrentUser();
  const logoutMutation = useLogoutUser();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
      navigate({ to: '/login' });
    } catch (_error) {
      // Handled by mutation state
    }
  };

  const navItems = [
    { label: 'Home', path: '/', icon: Home },
    { label: 'Today', path: '/today', icon: Calendar },
    { label: 'Inbox', path: '/inbox', icon: Inbox },
    { label: 'Tasks', path: '/tasks', icon: CheckCircle },
    { label: 'Notes', path: '/notes', icon: FileText },
  ];

  const userInitial = user?.email ? user.email.charAt(0).toUpperCase() : 'U';

  return (
    <aside className="w-64 h-full bg-sidebar border-r border-sidebar-border text-sidebar-foreground flex flex-col">
      {/* Branding Logo */}
      <div className="px-6 pt-8 pb-4 flex flex-col gap-0.5 select-none">
        <span className="font-serif text-2xl font-semibold tracking-tight text-foreground">
          Horizon
        </span>
        <span className="text-[9px] font-mono tracking-[0.25em] text-muted-foreground uppercase">
          Productivity
        </span>
      </div>

      {/* Prominent Action Button */}
      <div className="px-4 py-2">
        <button
          type="button"
          onClick={() => alert('Capture triggered (placeholder)')}
          className="w-full bg-primary text-primary-foreground font-medium rounded-md py-2.5 px-4 flex items-center justify-center gap-2 hover:bg-primary/95 transition-all text-sm cursor-pointer select-none"
        >
          <Plus className="h-4 w-4" />
          <span>Capture</span>
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-sidebar-foreground transition-all duration-200 cursor-pointer select-none',
                isActive
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer Section */}
      <div className="px-3 py-4 border-t border-sidebar-border mt-auto">
        <Link
          to="/settings"
          className={cn(
            'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-sidebar-foreground transition-all duration-200 cursor-pointer select-none mb-2',
            location.pathname === '/settings'
              ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
              : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          <span>Settings</span>
        </Link>

        {/* Profile Card */}
        <div className="flex items-center justify-between p-2 rounded-md bg-sidebar-accent/50 border border-sidebar-border/50">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-7 h-7 bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center justify-center rounded-full shrink-0 select-none">
              {userInitial}
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-[10px] text-muted-foreground select-none">Profile</span>
              <span
                className="text-xs font-medium text-sidebar-foreground truncate max-w-[120px]"
                title={user?.email}
              >
                {user?.email || 'Loading…'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
            className="text-muted-foreground hover:text-destructive p-1 rounded hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer shrink-0"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
