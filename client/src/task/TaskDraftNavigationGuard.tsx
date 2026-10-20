/* eslint-disable react-refresh/only-export-components */
import { useBlocker } from '@tanstack/react-router';
import * as Dialog from '@radix-ui/react-dialog';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { cancelPendingLogoutNavigations } from '@/user/logoutNavigation';

export interface TaskDraftRegistration {
  id: string;
  kind: 'create' | 'field';
  dirty: boolean;
  pending: boolean;
  save?: () => Promise<boolean>;
  discard: () => void;
}

interface DraftGuardApi {
  register: (registration: TaskDraftRegistration | null) => void;
  clear: (id: string) => void;
  bypass: (action: () => void | Promise<unknown>) => Promise<void>;
  reset: () => void;
  isBlocked: boolean;
  isPending: boolean;
  blockedCreateTraversal: boolean;
  keepCreateForHistoryRestore: () => void;
  retainCreateDuringHistoryRestore: boolean;
  clearCreateHistoryRestore: () => void;
}

const DraftGuardContext = createContext<DraftGuardApi | null>(null);

export function TaskDraftNavigationGuard({ children }: { children: React.ReactNode }) {
  const registrationRef = useRef<TaskDraftRegistration | null>(null);
  const registrationGenerationRef = useRef(0);
  const skipBlocker = useRef(false);
  const [registrationState, setRegistrationState] = useState<TaskDraftRegistration | null>(null);
  const [retainCreateDuringHistoryRestore, setRetainCreateDuringHistoryRestore] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const blocker = useBlocker({
    shouldBlockFn: () =>
      !skipBlocker.current &&
      Boolean(registrationRef.current?.dirty || registrationRef.current?.pending),
    enableBeforeUnload: () =>
      Boolean(registrationRef.current?.dirty || registrationRef.current?.pending),
    withResolver: true,
  });
  const blockerRef = useRef(blocker);
  useEffect(() => {
    blockerRef.current = blocker;
  }, [blocker]);

  const register = useCallback((registration: TaskDraftRegistration | null) => {
    const previous = registrationRef.current;
    registrationRef.current = registration;
    if (previous?.id !== registration?.id) registrationGenerationRef.current += 1;
    if (
      previous?.id !== registration?.id ||
      previous?.kind !== registration?.kind ||
      previous?.dirty !== registration?.dirty ||
      previous?.pending !== registration?.pending
    ) {
      setRegistrationState(registration);
    }
    if (!registration?.dirty && !registration?.pending && blockerRef.current.status === 'blocked') {
      blockerRef.current.reset();
    }
  }, []);

  const clear = useCallback(
    (id: string) => {
      if (registrationRef.current?.id === id) register(null);
    },
    [register]
  );

  const bypass = useCallback(async (action: () => void | Promise<unknown>) => {
    skipBlocker.current = true;
    try {
      await action();
    } finally {
      skipBlocker.current = false;
    }
  }, []);

  const current = registrationState;
  const isPending = Boolean(current?.pending);
  const blockedCreateTraversal =
    blocker.status === 'blocked' &&
    isPending &&
    current?.kind === 'create' &&
    (blocker.action === 'BACK' || blocker.action === 'FORWARD') &&
    blocker.current !== undefined &&
    'create' in blocker.current.search &&
    blocker.current.search.create === true;
  const api = useMemo<DraftGuardApi>(
    () => ({
      register,
      clear,
      bypass,
      reset: () => {
        if (blocker.status === 'blocked') blocker.reset();
      },
      isBlocked: blocker.status === 'blocked',
      isPending,
      blockedCreateTraversal,
      keepCreateForHistoryRestore: () => {
        if (blocker.action === 'BACK' || blocker.action === 'FORWARD') {
          setRetainCreateDuringHistoryRestore(registrationRef.current?.kind === 'create');
        }
      },
      retainCreateDuringHistoryRestore,
      clearCreateHistoryRestore: () => setRetainCreateDuringHistoryRestore(false),
    }),
    [
      register,
      clear,
      bypass,
      blocker,
      isPending,
      blockedCreateTraversal,
      retainCreateDuringHistoryRestore,
    ]
  );

  async function discardAndProceed() {
    const active = registrationRef.current;
    active?.discard();
    setSaveFailed(false);
    registrationRef.current = null;
    setRegistrationState(null);
    setRetainCreateDuringHistoryRestore(false);
    if (blocker.status === 'blocked') blocker.proceed();
  }

  function keepEditing() {
    cancelPendingLogoutNavigations();
    setSaveFailed(false);
    if (blocker.status === 'blocked') {
      if (blocker.action === 'BACK' || blocker.action === 'FORWARD') {
        setRetainCreateDuringHistoryRestore(registrationRef.current?.kind === 'create');
      }
      blocker.reset();
    }
  }

  async function saveAndProceed() {
    const active = registrationRef.current;
    if (!active?.save) return;
    const activeId = active.id;
    const generation = registrationGenerationRef.current;
    const originalProceed = blockerRef.current.proceed;
    const saved = await active.save();
    if (
      registrationRef.current?.id !== activeId ||
      registrationGenerationRef.current !== generation
    ) {
      return;
    }
    const currentBlocker = blockerRef.current;
    if (!saved) {
      if (currentBlocker.status === 'blocked') setSaveFailed(true);
      return;
    }
    setSaveFailed(false);
    registrationRef.current = null;
    setRegistrationState(null);
    if (currentBlocker.status === 'blocked') {
      if (currentBlocker.proceed === originalProceed) currentBlocker.proceed();
      else currentBlocker.reset();
    }
  }

  return (
    <DraftGuardContext.Provider value={api}>
      {children}
      <Dialog.Root open={blocker.status === 'blocked'}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/45" />
          <Dialog.Content
            role="alertdialog"
            aria-describedby="task-draft-description"
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              keepEditing();
            }}
            className="fixed left-1/2 top-1/2 z-[101] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-xl outline-none"
          >
            <Dialog.Title className="text-base font-semibold text-foreground">
              {isPending
                ? current?.kind === 'create'
                  ? 'Creating task…'
                  : 'Saving field…'
                : 'Discard draft?'}
            </Dialog.Title>
            <Dialog.Description
              id="task-draft-description"
              className="mt-2 text-sm text-muted-foreground"
            >
              {isPending
                ? 'Your changes are being saved. Stay here while the request finishes.'
                : saveFailed
                  ? 'Could not save this field. Your draft is still here. Try saving again.'
                  : 'Your task draft has unsaved changes.'}
            </Dialog.Description>
            <div
              role="group"
              aria-label="Draft actions"
              className="mt-6 flex flex-wrap justify-end gap-2"
            >
              {isPending ? (
                <Button type="button" variant="outline" onClick={keepEditing}>
                  Stay here
                </Button>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={keepEditing}>
                    Keep editing
                  </Button>
                  {current?.kind === 'field' && current.save && (
                    <Button type="button" variant="outline" onClick={() => void saveAndProceed()}>
                      Save and continue
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => void discardAndProceed()}
                  >
                    {current?.kind === 'field' ? 'Discard and continue' : 'Discard draft'}
                  </Button>
                </>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </DraftGuardContext.Provider>
  );
}

export function useTaskDraftGuard(): DraftGuardApi | null {
  return useContext(DraftGuardContext);
}
