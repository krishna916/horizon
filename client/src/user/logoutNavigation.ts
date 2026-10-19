let logoutNavigationGeneration = 0;
let logoutFailure: string | null = null;

export const LOGOUT_FAILURE_MESSAGE = 'Sign out failed. Please try again.';

export function beginLogoutNavigation() {
  logoutNavigationGeneration += 1;
  return logoutNavigationGeneration;
}

export function cancelPendingLogoutNavigations() {
  logoutNavigationGeneration += 1;
}

export function isCurrentLogoutNavigation(generation: number) {
  return generation === logoutNavigationGeneration;
}

export function saveLogoutFailure() {
  logoutFailure = LOGOUT_FAILURE_MESSAGE;
}

export function consumeLogoutFailure() {
  const failure = logoutFailure;
  logoutFailure = null;
  return failure;
}
