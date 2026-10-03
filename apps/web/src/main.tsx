import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiContext, createHttpApi } from './api/api';
import { HuajunDriver } from '@macrofill/scale/huajun';
import { App } from './App';
import './i18n';
import { OutboxStoreContext } from './outbox/Outbox';
import { ScaleContext, scaleDriverFactory } from './scale';
import { ScannerContext, scannerFactory } from './scanner';
import { deviceStores } from './storage/device';
import { DraftContext } from './storage/drafts';
import './styles.css';

const stores = deviceStores();
const container = document.getElementById('root');
if (container === null) throw new Error('Missing #root element');

void Promise.all([scaleDriverFactory(() => new HuajunDriver()), scannerFactory()]).then(
  ([createScaleDriver, scanner]) =>
    createRoot(container).render(
      <StrictMode>
        <ApiContext value={createHttpApi()}>
          <DraftContext value={stores.drafts}>
            <OutboxStoreContext value={stores.outbox}>
              <ScaleContext value={createScaleDriver}>
                <ScannerContext value={scanner}>
                  <App />
                </ScannerContext>
              </ScaleContext>
            </OutboxStoreContext>
          </DraftContext>
        </ApiContext>
      </StrictMode>,
    ),
);
