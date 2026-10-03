import { fireEvent, render, screen, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext, ApiError, type Api } from '../src/api/api';
import { App } from '../src/App';
import en from '../src/i18n/en.json';
import { OutboxStoreContext } from '../src/outbox/Outbox';
import { indexedDbOutbox } from '../src/outbox/store';
import { stored, fakeApi } from './support/api';
import { outboxItem } from './support/outbox';

// #95: signing out, from the main screen.

const signOut = () => screen.getByRole('button', { name: en.signOut.button });
const loginDialog = () => screen.findByRole('dialog', { name: en.login.title });

async function renderApp(api: Api = fakeApi(), outbox = indexedDbOutbox(new IDBFactory())) {
  render(
    <ApiContext value={api}>
      <OutboxStoreContext value={outbox}>
        <App />
      </OutboxStoreContext>
    </ApiContext>,
  );
  await screen.findByRole('button', { name: en.home.logMeal });
  return { api, outbox };
}

/** The server doesn't answer, so the queued meal stays queued. */
const offlineSave = () => vi.fn<Api['saveMeal']>(() => Promise.reject(new TypeError('Failed')));

describe('Sign out (#95)', () => {
  it('#95-1: the main screen has a Sign out button, and a meal in progress has none', async () => {
    await renderApp();
    expect(signOut()).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: en.home.logMeal }));
    await screen.findByRole('heading', { name: en.recipes.title });
    expect(screen.queryByRole('button', { name: en.signOut.button })).toBeNull();
  });

  it('#95-3: signing out ends the session on the server and shows the login form, with the app hidden', async () => {
    const { api } = await renderApp();
    fireEvent.click(signOut());
    await loginDialog();
    expect(api.logout).toHaveBeenCalledTimes(1);
    // Nothing of the app is visible under the form: no meals, no targets.
    expect(screen.queryByRole('button', { name: en.home.logMeal })).toBeNull();
    expect(screen.queryByRole('heading', { name: en.today.title })).toBeNull();
    // No confirmation when nothing is waiting to be sent.
    expect(screen.queryByRole('dialog', { name: en.signOut.confirmTitle })).toBeNull();
  });

  it('#95-3: the same user logging in again gets the main screen back', async () => {
    await renderApp();
    fireEvent.click(signOut());
    const dialog = await loginDialog();
    fireEvent.change(within(dialog).getByLabelText(en.login.username), {
      target: { value: 'mlewand' },
    });
    fireEvent.change(within(dialog).getByLabelText(en.login.password), {
      target: { value: 'the password' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.login.submit }));
    expect(await screen.findByRole('button', { name: en.home.logMeal })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: en.login.title })).toBeNull();
  });

  it('#95-4: if the server cannot be reached, it says so and the user stays signed in', async () => {
    let online = false;
    const logout = vi.fn<Api['logout']>(() =>
      online ? Promise.resolve() : Promise.reject(new TypeError('Failed to fetch')),
    );
    await renderApp(fakeApi({ logout }));
    fireEvent.click(signOut());
    expect(await screen.findByRole('alert')).toHaveTextContent(en.signOut.failed);
    expect(screen.queryByRole('dialog', { name: en.login.title })).toBeNull();
    expect(screen.getByRole('button', { name: en.home.logMeal })).toBeVisible();
    expect(signOut()).toBeEnabled();
    // Back online, the same button works, and the message is gone.
    online = true;
    fireEvent.click(signOut());
    await loginDialog();
    expect(screen.queryByText(en.signOut.failed)).toBeNull();
  });

  it('#95-4: an error from the server is reported the same way', async () => {
    await renderApp(fakeApi({ logout: () => Promise.reject(new ApiError(500)) }));
    fireEvent.click(signOut());
    expect(await screen.findByRole('alert')).toHaveTextContent(en.signOut.failed);
    expect(screen.queryByRole('dialog', { name: en.login.title })).toBeNull();
  });

  it('#95-5: meals queued on the device stay there, and go to the server when that user logs in again', async () => {
    const outbox = indexedDbOutbox(new IDBFactory());
    await outbox.add(outboxItem(1));
    let online = false;
    const saveMeal = vi.fn<Api['saveMeal']>((r) =>
      online ? Promise.resolve(stored(r)) : Promise.reject(new TypeError('Failed')),
    );
    await renderApp(fakeApi({ saveMeal }), outbox);
    await screen.findByText(en.today.pending);
    fireEvent.click(signOut());
    fireEvent.click(await screen.findByRole('button', { name: en.signOut.confirm }));
    const dialog = await loginDialog();
    expect(await outbox.all()).toHaveLength(1);

    online = true;
    fireEvent.change(within(dialog).getByLabelText(en.login.username), {
      target: { value: 'mlewand' },
    });
    fireEvent.change(within(dialog).getByLabelText(en.login.password), {
      target: { value: 'the password' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.login.submit }));
    await vi.waitFor(async () => expect(await outbox.all()).toEqual([]));
    expect(saveMeal).toHaveBeenLastCalledWith(outboxItem(1).request);
  });

  it('#95-6: with unsent meals, a confirmation says they stay on the device, and Cancel keeps the user signed in', async () => {
    const outbox = indexedDbOutbox(new IDBFactory());
    await outbox.add(outboxItem(1));
    const { api } = await renderApp(fakeApi({ saveMeal: offlineSave() }), outbox);
    await screen.findByText(en.today.pending);
    fireEvent.click(signOut());
    const confirm = await screen.findByRole('dialog', { name: en.signOut.confirmTitle });
    expect(confirm).toHaveTextContent(en.signOut.unsent);
    expect(api.logout).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: en.signOut.cancel }));
    expect(screen.queryByRole('dialog', { name: en.signOut.confirmTitle })).toBeNull();
    expect(api.logout).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: en.home.logMeal })).toBeVisible();

    // Asked again, and confirmed.
    fireEvent.click(signOut());
    fireEvent.click(await screen.findByRole('button', { name: en.signOut.confirm }));
    await loginDialog();
    expect(api.logout).toHaveBeenCalledTimes(1);
  });

  it('#95-6: a meal the server refused for good is not waiting to be sent, so no confirmation', async () => {
    const outbox = indexedDbOutbox(new IDBFactory());
    await outbox.add({ ...outboxItem(1), refused: 409 });
    const { api } = await renderApp(fakeApi({ saveMeal: offlineSave() }), outbox);
    fireEvent.click(signOut());
    await loginDialog();
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: en.signOut.confirmTitle })).toBeNull();
  });
});
