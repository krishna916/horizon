export type SessionUnauthorizedHandler = (requestEpoch: number) => void;

let currentSessionEpoch = 0;
let unauthorizedHandler: SessionUnauthorizedHandler | null = null;

export function getCurrentSessionEpoch(): number {
  return currentSessionEpoch;
}

export function setCurrentSessionEpoch(epoch: number): void {
  currentSessionEpoch = epoch;
}

export function subscribeToSessionUnauthorized(handler: SessionUnauthorizedHandler): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

export function notifySessionUnauthorized(requestEpoch: number): void {
  if (requestEpoch === currentSessionEpoch) unauthorizedHandler?.(requestEpoch);
}
