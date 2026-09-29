import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
// The linted snippets don't exist on disk, so the type-aware project service
// can't see them. The rules under test don't need type information.
const eslint = new ESLint({
  cwd: root,
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

const importRules = new Set([
  'no-restricted-imports',
  '@typescript-eslint/no-restricted-imports',
  'local/no-cross-package-relative-import',
]);

async function lint(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath });
  const messages = result?.messages ?? [];
  const fatal = messages.filter((m) => m.fatal === true);
  if (fatal.length > 0) throw new Error(fatal.map((m) => m.message).join('\n'));
  return messages;
}

async function importErrors(filePath: string, code: string): Promise<string[]> {
  return (await lint(filePath, code))
    .filter((m) => m.ruleId !== null && importRules.has(m.ruleId))
    .map((m) => m.message);
}

function expectAllowed(filePath: string, code: string) {
  return expect(importErrors(filePath, code)).resolves.toEqual([]);
}

function expectRejected(filePath: string, code: string) {
  return expect(importErrors(filePath, code)).resolves.not.toEqual([]);
}

describe('M1-7: ESLint enforces the package import rules', () => {
  describe('domain imports only zod', () => {
    const file = 'packages/domain/src/example.ts';

    it('allows zod and relative imports', async () => {
      await expectAllowed(
        file,
        "import { z } from 'zod';\nimport { a } from './a';\nexport { z, a };\n",
      );
      await expectAllowed(file, "import { b } from '../b/c';\nexport { b };\n");
    });

    it.each([
      "import { x } from '@macrofill/scale';",
      "import { x } from '@macrofill/api';",
      "import { x } from '@macrofill/web';",
      "import { readFile } from 'node:fs';",
      "import { readFile } from 'fs';",
      "import { useState } from 'react';",
      "import { Hono } from 'hono';",
      "import { x } from '../../../packages/scale/src/index';",
    ])('rejects %s', async (code) => {
      await expectRejected(file, `${code}\nexport { };\n`);
    });
  });

  describe('scale imports domain but not the apps', () => {
    const file = 'packages/scale/src/example.ts';

    it('allows domain', async () => {
      await expectAllowed(file, "import { x } from '@macrofill/domain';\nexport { x };\n");
    });

    it.each([
      "import { x } from '@macrofill/api';",
      "import { x } from '@macrofill/web';",
      "import { x } from '@macrofill/api/client';",
      "import { x } from '@macrofill/web/src/App';",
      "import { x } from '../../../apps/api/src/index';",
    ])('rejects %s', async (code) => {
      await expectRejected(file, `${code}\nexport { };\n`);
    });
  });

  describe('api imports domain but not scale or web', () => {
    const file = 'apps/api/src/example.ts';

    it('allows domain', async () => {
      await expectAllowed(file, "import { x } from '@macrofill/domain';\nexport { x };\n");
    });

    it.each([
      "import { x } from '@macrofill/scale';",
      "import { x } from '@macrofill/web';",
      "import { x } from '@macrofill/scale/src/index';",
      "import { x } from '@macrofill/web/src/App';",
      "import { x } from '../../../packages/scale/src/index';",
    ])('rejects %s', async (code) => {
      await expectRejected(file, `${code}\nexport { };\n`);
    });
  });

  describe('web imports domain and scale, and api for types only', () => {
    const file = 'apps/web/src/example.ts';

    it('allows domain, scale and type-only api imports', async () => {
      await expectAllowed(
        file,
        "import { x } from '@macrofill/domain';\nimport { y } from '@macrofill/scale';\nimport type { AppType } from '@macrofill/api';\nexport { x, y };\nexport type { AppType };\n",
      );
    });

    it('allows type-only imports from api subpaths', async () => {
      await expectAllowed(
        file,
        "import type { Client } from '@macrofill/api/client';\nexport type { Client };\n",
      );
    });

    it.each(['@macrofill/api', '@macrofill/api/client'])(
      'rejects value imports from %s',
      async (source) => {
        await expectRejected(
          file,
          `import { createApp } from '${source}';\nexport { createApp };\n`,
        );
      },
    );

    it('rejects relative imports into api sources', async () => {
      await expectRejected(
        file,
        "import type { X } from '../../api/src/index';\nexport type { X };\n",
      );
    });
  });
});

describe('domain has no clock and no randomness', () => {
  const file = 'packages/domain/src/example.ts';

  async function clockErrors(code: string): Promise<string[]> {
    return (await lint(file, code))
      .filter((m) => m.ruleId === 'no-restricted-properties' || m.ruleId === 'no-restricted-syntax')
      .map((m) => m.message);
  }

  it.each([
    'export const t = Date.now();',
    'export const d = new Date();',
    'export const s = Date();',
    'export const r = Math.random();',
  ])('rejects %s', async (code) => {
    await expect(clockErrors(code)).resolves.not.toEqual([]);
  });

  it('allows constructing a Date from a given value', async () => {
    await expect(clockErrors('export const d = (ms: number) => new Date(ms);')).resolves.toEqual(
      [],
    );
  });
});
