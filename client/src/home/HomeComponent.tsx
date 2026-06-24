import React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLogoutUser } from '../user/hooks/useLogoutUser'
import { Button } from '@/components/ui/button'

void React

export function HomeComponent() {
  const logoutMutation = useLogoutUser();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
      navigate({ to: '/login' });
    } catch (error) {
      // Ignored or handled by mutation state
    }
  };

  return (
    <div className="w-full min-h-svh flex flex-col items-center justify-center p-6 text-center">
      <h1 className="text-4xl font-medium tracking-tight text-foreground mb-4">Welcome to Horizon</h1>
      <p className="text-muted-foreground max-w-md">This is the landing route of your modular productivity workspace.</p>
      <div className="mt-6">
        <Button
          variant="outline"
          onClick={handleLogout}
          disabled={logoutMutation.isPending}
        >
          {logoutMutation.isPending ? 'Logging out…' : 'Logout'}
        </Button>
      </div>
    </div>
  )
}
