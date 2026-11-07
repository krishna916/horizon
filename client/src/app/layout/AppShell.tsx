import { Outlet } from '@tanstack/react-router';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { AppContent } from './AppContent';
import { AuthenticatedSessionBoundary } from './AuthenticatedSessionBoundary';

export function AppShell() {
  return (
    <AuthenticatedSessionBoundary>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground antialiased font-sans">
        <AppSidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <AppHeader />
          <AppContent>
            <Outlet />
          </AppContent>
        </div>
      </div>
    </AuthenticatedSessionBoundary>
  );
}
