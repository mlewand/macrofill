import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiContext, createHttpApi } from './api/api';
import { HuajunDriver } from '@macrofill/scale/huajun';
import { App } from './App';
import './i18n';
import { ScaleContext } from './scale';
import './styles.css';

const container = document.getElementById('root');
if (container === null) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <ApiContext value={createHttpApi()}>
      <ScaleContext value={() => new HuajunDriver()}>
        <App />
      </ScaleContext>
    </ApiContext>
  </StrictMode>,
);
