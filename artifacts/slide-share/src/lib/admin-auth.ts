// Presenter/admin password, shared between home.tsx and presenter.tsx via
// sessionStorage. There's no client-side way to verify a password against
// the server ahead of time (PRESENTER_PASSWORD lives server-side, often a
// random value generated at deploy time) — so entry is optimistic, and
// callers should check isAuthError() on the first real admin request and
// bounce back to the password gate if it comes back 401.
const STORAGE_KEY = 'ss_admin_password';

export function getAdminPassword(): string {
  return sessionStorage.getItem(STORAGE_KEY) ?? '';
}

export function setAdminPassword(password: string): void {
  sessionStorage.setItem(STORAGE_KEY, password);
}

export function clearAdminPassword(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function isAdminUnlocked(): boolean {
  return sessionStorage.getItem(STORAGE_KEY) !== null;
}

export function isAuthError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 401;
}
