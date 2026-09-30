import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiContext } from '../src/api/api';
import { App } from '../src/App';
import en from '../src/i18n/en.json';
import { fakeApi } from './support/api';

const renderApp = () =>
  render(
    <ApiContext value={fakeApi()}>
      <App />
    </ApiContext>,
  );

describe('M1-1: web app skeleton', () => {
  it('renders the app name from the i18n catalog', () => {
    renderApp();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en.app.name);
  });

  it('sets the browser tab title from the i18n catalog', () => {
    document.title = 'stale';
    renderApp();
    expect(document.title).toBe(en.app.name);
  });
});
