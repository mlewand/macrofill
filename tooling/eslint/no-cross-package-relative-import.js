// Rejects relative imports that leave the importing file's workspace package,
// e.g. `../../api/src/index` from `apps/web`. Cross-package imports must go
// through the package name, so `no-restricted-imports` can check them.
import path from 'node:path';

const packageRoot = /^(.*[\\/](?:apps|packages)[\\/][^\\/]+)[\\/]/;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow relative imports into another workspace package' },
    messages: {
      crossPackage:
        "'{{source}}' reaches outside this package. Import another package by its name.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename;
    const root = packageRoot.exec(filename)?.[1];
    if (root === undefined) return {};

    /**
     * @param {import('estree').ImportDeclaration | import('estree').ExportNamedDeclaration
     *   | import('estree').ExportAllDeclaration | import('estree').ImportExpression} node
     */
    const check = (node) => {
      const sourceNode = node.source;
      if (sourceNode?.type !== 'Literal') return;
      const source = sourceNode.value;
      if (typeof source !== 'string' || !source.startsWith('.')) return;
      const target = path.resolve(path.dirname(filename), source);
      const relative = path.relative(root, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        context.report({ node: sourceNode, messageId: 'crossPackage', data: { source } });
      }
    };

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};
