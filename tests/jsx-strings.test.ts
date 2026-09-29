import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
// The linted snippets don't exist on disk, so the type-aware project service can't see them.
const eslint = new ESLint({
  cwd: root,
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

async function stringErrors(code: string, filePath = 'apps/web/src/Example.tsx') {
  const [result] = await eslint.lintText(code, { filePath });
  const messages = result?.messages ?? [];
  const fatal = messages.filter((m) => m.fatal === true);
  if (fatal.length > 0) throw new Error(fatal.map((m) => m.message).join('\n'));
  return messages.filter((m) => m.ruleId === 'local/no-hardcoded-jsx-string').length;
}

const component = (jsx: string) =>
  `const t = (k: string) => k;\nconst x = 1;\nexport const C = () => (${jsx});\n`;

describe('M5-10: lint fails on hardcoded UI strings in JSX', () => {
  it.each([
    ['JSX text', '<p>Save meal</p>'],
    ['JSX text next to an expression', "<p>{t('a')} grams</p>"],
    ['a string literal child', "<p>{'Save'}</p>"],
    ['a template literal child', '<p>{`Step ${x}`}</p>'],
    ['a string in a conditional child', "<p>{x ? 'Yes' : t('no')}</p>"],
    ['a string in a logical child', "<p>{x && 'Loading'}</p>"],
    ['aria-label', '<button aria-label="Close" />'],
    ['placeholder', '<input placeholder="Grams" />'],
    ['title', "<div title={'Help'} />"],
    ['alt', '<img alt="Logo" />'],
    ['non-English text', '<p>Zapisz</p>'],
  ])('rejects %s', async (_case, jsx) => {
    expect(await stringErrors(component(jsx))).toBeGreaterThan(0);
  });

  it.each([
    ['translated text', "<p>{t('meal.save')}</p>"],
    ['translated attributes', "<button aria-label={t('close')} title={t('help')} />"],
    ['whitespace and punctuation only', "<p>\n  {t('a')} · {t('b')}: {x}%\n</p>"],
    ['numbers', '<p>{x} 100</p>'],
    [
      'non-UI attributes',
      '<input className="grams-input wide" type="text" inputMode="decimal" data-testid="grams" id="g" name="grams" role="status" />',
    ],
    ['a key', '<li key="step">{t(\'a\')}</li>'],
  ])('allows %s', async (_case, jsx) => {
    expect(await stringErrors(component(jsx))).toBe(0);
  });

  it('applies to the web app, not to tests', async () => {
    expect(await stringErrors(component('<p>Save</p>'), 'apps/web/test/Example.test.tsx')).toBe(0);
  });
});
