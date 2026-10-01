import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext, ApiError, type Api } from '../src/api/api';
import { App } from '../src/App';
import en from '../src/i18n/en.json';
import { emptyCatalog, emptyToday, fakeApi } from './support/api';

const renderApp = (api: Api) =>
  render(
    <ApiContext value={api}>
      <App />
    </ApiContext>,
  );

/** today() answers 401 until login succeeds. */
function loggedOutApi(overrides: Partial<Api> = {}) {
  let session = false;
  const api = fakeApi({
    today: () => (session ? Promise.resolve(emptyToday) : Promise.reject(new ApiError(401))),
    login: (username, password) => {
      session = username === 'mlewand' && password === 'the password';
      return Promise.resolve(session ? 'ok' : 'invalid');
    },
    ...overrides,
  });
  return api;
}

async function fillLogin(username: string, password: string) {
  const dialog = await screen.findByRole('dialog', { name: en.login.title });
  fireEvent.change(within(dialog).getByLabelText(en.login.username), {
    target: { value: username },
  });
  fireEvent.change(within(dialog).getByLabelText(en.login.password), {
    target: { value: password },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: en.login.submit }));
  return dialog;
}

describe('login (M4-1, M4-2)', () => {
  it('M4-2: a 401 from the api asks to log in; logging in shows the app again', async () => {
    const api = loggedOutApi();
    renderApp(api);
    const dialog = await fillLogin('mlewand', 'the password');
    expect(api.login).toHaveBeenCalledWith('mlewand', 'the password');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    // The home screen loads again with the new session.
    expect(await screen.findByRole('heading', { name: en.today.title })).toBeInTheDocument();
    expect(screen.queryByText(en.today.loadFailed)).not.toBeInTheDocument();
  });

  it('M4-1: wrong credentials say so and keep the form', async () => {
    renderApp(loggedOutApi());
    const dialog = await fillLogin('mlewand', 'wrong');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(en.login.invalid);
    expect(within(dialog).getByLabelText(en.login.username)).toHaveValue('mlewand');
    expect(within(dialog).getByLabelText(en.login.password)).toHaveValue('');
  });

  it('M4-1: a failed request says the login could not be checked', async () => {
    renderApp(loggedOutApi({ login: () => Promise.reject(new TypeError('offline')) }));
    const dialog = await fillLogin('mlewand', 'the password');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(en.login.failed);
  });

  it('M4-2: the login form uses the browser password manager fields', async () => {
    renderApp(loggedOutApi());
    const dialog = await screen.findByRole('dialog', { name: en.login.title });
    expect(within(dialog).getByLabelText(en.login.username)).toHaveFocus();
    expect(within(dialog).getByLabelText(en.login.username)).toHaveAttribute(
      'autocomplete',
      'username',
    );
    expect(within(dialog).getByLabelText(en.login.password)).toHaveAttribute('type', 'password');
    expect(within(dialog).getByLabelText(en.login.password)).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
  });

  it('M4-2: a session ending mid-flow asks to log in over the open screen, which stays', async () => {
    const catalog = vi
      .fn<Api['catalog']>()
      .mockRejectedValueOnce(new ApiError(401))
      .mockResolvedValue(emptyCatalog);
    renderApp(fakeApi({ catalog, login: () => Promise.resolve('ok') }));
    fireEvent.click(await screen.findByRole('button', { name: en.home.logMeal }));
    const dialog = await fillLogin('mlewand', 'the password');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    // Still on the flow's screen: its retry works with the new session.
    fireEvent.click(screen.getByRole('button', { name: en.app.retry }));
    expect(await screen.findByText(en.recipes.title)).toBeInTheDocument();
  });

  it('M4-2: other api errors do not ask to log in', async () => {
    renderApp(fakeApi({ today: () => Promise.reject(new ApiError(500)) }));
    expect(await screen.findByText(en.today.loadFailed)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
