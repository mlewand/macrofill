// Who last logged in on this device: the api keeps the session in an HttpOnly cookie, so the app
// only knows the username typed into the login form. Kept data on the device (the Direct Entry
// draft, M5-8; the outbox, M5-9) is stamped with it, so another user logging in never gets someone else's meal.

const KEY = 'macrofill.user';

/** This tab's copy, for when local storage is unavailable (blocked, private mode). */
let remembered: string | undefined;

export function lastUser(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return remembered;
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
  remembered = username;
  try {
    localStorage.setItem(KEY, username);
  } catch {
    // Without storage, kept data just isn't tied to a user.
  }
}

/** Whether data stamped with `owner` may be used by `user`. Unknown on either side means yes. */
export function belongsTo(owner: string | undefined, user: string | undefined): boolean {
  return owner === undefined || user === undefined || owner === user;
}

/** Whether data stamped with `owner` may be used now. */
export function belongsToCurrentUser(owner: string | undefined): boolean {
  return belongsTo(owner, lastUser());
}

/**
 * Whether a meal stamped with `owner` is `user`'s: both known and the same. Stricter than
 * `belongsTo`, for what's queued to be sent or shown (M5-9): an unknown user sees and sends none.
 */
export function isOwnedBy(owner: string | undefined, user: string | undefined): boolean {
  return owner !== undefined && owner === user;
}
