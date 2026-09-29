import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const configPath = fileURLToPath(new URL('../tsconfig.json', import.meta.url));

function diagnosticsFor(source: string): string[] {
  const config: unknown = ts.readConfigFile(configPath, (p) => ts.sys.readFile(p)).config;
  const parsed = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    fileURLToPath(new URL('..', import.meta.url)),
  );
  const probe = fileURLToPath(new URL('../src/__probe__.ts', import.meta.url));
  const host = ts.createCompilerHost(parsed.options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (p) => (p === probe ? source : readFile(p));
  host.fileExists = (p) => p === probe || fileExists(p);
  host.getSourceFile = (p, lang, ...rest) =>
    p === probe ? ts.createSourceFile(p, source, lang) : getSourceFile(p, lang, ...rest);
  const program = ts.createProgram([...parsed.fileNames, probe], parsed.options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

describe("M1-7: domain's tsconfig has no DOM or Node types", () => {
  it('type-checks plain ES2022 code', () => {
    expect(diagnosticsFor('export const n: number = [1, 2].at(0) ?? 0;\n')).toEqual([]);
  });

  it.each([
    ['DOM', 'export const t = document.title;\n'],
    ['DOM', 'export const w = window;\n'],
    ['Node', 'export const e = process.env;\n'],
    ['Node', "export const b = Buffer.from('');\n"],
    ['timers', 'export const h = setTimeout(() => {}, 1);\n'],
    ['Web Crypto', 'export const id = crypto.randomUUID();\n'],
  ])('rejects %s globals: %s', (_kind, source) => {
    expect(diagnosticsFor(source)).not.toEqual([]);
  });
});
