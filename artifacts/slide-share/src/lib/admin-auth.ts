// Presenter/admin password, shared between home.tsx and presenter.tsx via
// sessionStorage. The password gates call verifyAdminPassword() against the
// server before granting access, so a wrong password never reaches the
// dashboard. isAuthError() remains as defense-in-depth for the rare case
// where the server-side password changes mid-session.
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

export async function verifyAdminPassword(password: string): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
