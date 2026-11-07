import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAuthSession } from '@/user/session/AuthSessionProvider';

export function AuthenticatedSessionBoundary({ children }: { readonly children: ReactNode }) {
  const { phase, verifySession } = useAuthSession();
  const navigate = useNavigate();
  const privateContentHidden = phase !== 'verified';

  useEffect(() => {
    if (phase === 'unauthenticated') {
      void navigate({ to: '/login', replace: true });
    }
  }, [navigate, phase]);

  return (
    <>
      <div
        data-testid="private-content"
        aria-hidden={privateContentHidden}
        inert={privateContentHidden ? true : undefined}
        className={privateContentHidden ? 'invisible pointer-events-none' : undefined}
      >
        {children}
      </div>
      {phase === 'verifying' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background"
          role="status"
        >
          Verifying session…
        </div>
      )}
      {phase === 'retryable-error' && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background">
          <p role="alert">We couldn't verify your session. Your private content is hidden.</p>
          <button type="button" onClick={() => void verifySession()}>
            Retry session verification
          </button>
        </div>
      )}
      {phase === 'unauthenticated' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background"
          role="status"
        >
          Your session has ended. Redirecting to Login…
        </div>
      )}
    </>
  );
}
