// Who last logged in on this device: the api keeps the session in an HttpOnly cookie, so the app
// only knows the username typed into the login form. Kept data on the device (the Direct Entry
// draft, M5-8) is stamped with it, so another user logging in never gets someone else's meal.

const KEY = 'macrofill.user';

export function lastUser(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Calls `cb` when another tab logs in as someone (it changes the remembered user). */
export function onUserChangedElsewhere(cb: (username: string) => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === KEY && event.newValue !== null) cb(event.newValue);
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

export function rememberUser(username: string): void {
  try {
    localStorage.setItem(KEY, username);
  } catch {
    // Without storage, kept data just isn't tied to a user.
  }
}

/** Whether data stamped with `owner` may be used now. Unknown on either side means yes. */
export function belongsToCurrentUser(owner: string | undefined): boolean {
  const current = lastUser();
  return owner === undefined || current === undefined || owner === current;
}
