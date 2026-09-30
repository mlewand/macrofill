import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import '../src/i18n';

// Testing Library cleans up by itself only with Vitest globals, which this project doesn't use.
afterEach(cleanup);
