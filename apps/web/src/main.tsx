import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiContext, createHttpApi } from './api/api';
import { HuajunDriver } from '@macrofill/scale/huajun';
import { App } from './App';
import './i18n';
import { ScaleContext, scaleDriverFactory } from './scale';
import { DraftContext, indexedDbDraftStore } from './storage/drafts';
import './styles.css';

const container = document.getElementById('root');
if (container === null) throw new Error('Missing #root element');

void scaleDriverFactory(() => new HuajunDriver()).then((createScaleDriver) =>
  createRoot(container).render(
    <StrictMode>
      <ApiContext value={createHttpApi()}>
        <DraftContext value={indexedDbDraftStore()}>
          <ScaleContext value={createScaleDriver}>
            <App />
          </ScaleContext>
        </DraftContext>
      </ApiContext>
    </StrictMode>,
  ),
);
