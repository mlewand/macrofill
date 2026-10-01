import { afterEach, describe, expect, it, vi } from 'vitest';
import { lastUser, onUserChangedElsewhere, rememberUser } from '../src/session';

describe('the remembered user (M5-8)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // A save that works brings storage up to date again, for the next test.
    rememberUser('reset');
    localStorage.clear();
  });

  it('M5-8: when storage can be read but not written, the user who logged in here wins (regression: #37)', () => {
    localStorage.setItem('macrofill.user', 'mlewand');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    rememberUser('other');
    expect(lastUser()).toBe('other');
  });

  it('M5-8: a login in another tab is the remembered user again, after a failed write here', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    rememberUser('other');
    setItem.mockRestore();
    const off = onUserChangedElsewhere(() => undefined);
    localStorage.setItem('macrofill.user', 'third');
    window.dispatchEvent(new StorageEvent('storage', { key: 'macrofill.user', newValue: 'third' }));
    off();
    expect(lastUser()).toBe('third');
  });
});
