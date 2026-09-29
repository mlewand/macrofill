import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiContext, createHttpApi } from './api/api';
import { App } from './App';
import './i18n';
import './styles.css';

const container = document.getElementById('root');
if (container === null) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <ApiContext value={createHttpApi()}>
      <App />
    </ApiContext>
  </StrictMode>,
);
