// M5-10: UI text comes from the i18n catalog, so JSX must not contain hardcoded strings.
// Reports JSX text, string literals rendered as children, and strings in attributes the
// user sees or hears. Text without letters (whitespace, punctuation, numbers) is allowed.

const hasLetter = (/** @type {string} */ text) => /\p{L}/u.test(text);

// Attributes whose value is shown to the user or read by a screen reader. `children` is the
// prop spelling of rendered content.
const uiAttributes = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'children',
  'label',
  'placeholder',
  'title',
]);

/**
 * String literals an expression can evaluate to or contain, looking through conditionals,
 * logical operators and concatenation (`x ? 'a' : b`, `x && 'a'`, `'a ' + x`).
 * @param {any} node
 * @returns {any[]}
 */
function renderedStrings(node) {
  switch (node?.type) {
    case 'Literal':
      return typeof node.value === 'string' && hasLetter(node.value) ? [node] : [];
    case 'TemplateLiteral':
      return node.quasis.some((/** @type {any} */ q) => hasLetter(q.value.cooked ?? ''))
        ? [node]
        : [];
    case 'ConditionalExpression':
      return [...renderedStrings(node.consequent), ...renderedStrings(node.alternate)];
    case 'LogicalExpression':
      return [...renderedStrings(node.left), ...renderedStrings(node.right)];
    case 'BinaryExpression':
      return node.operator === '+'
        ? [...renderedStrings(node.left), ...renderedStrings(node.right)]
        : [];
    default:
      return [];
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow hardcoded UI strings in JSX; use the i18n catalog' },
    messages: {
      hardcoded: 'Hardcoded UI text "{{text}}". Put it in the i18n catalog and use t().',
    },
    schema: [],
  },
  create(context) {
    /** @param {any} node @param {string} text */
    const report = (node, text) =>
      context.report({ node, messageId: 'hardcoded', data: { text: text.trim().slice(0, 40) } });

    return {
      /** @param {any} node */
      JSXText(node) {
        if (hasLetter(node.value)) report(node, node.value);
      },
      /** @param {any} node */
      JSXExpressionContainer(node) {
        const parent = node.parent?.type;
        if (parent !== 'JSXElement' && parent !== 'JSXFragment') return;
        for (const literal of renderedStrings(node.expression)) {
          report(literal, context.sourceCode.getText(literal));
        }
      },
      /** @param {any} node */
      JSXAttribute(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : '';
        if (!uiAttributes.has(name) || node.value === null) return;
        const strings =
          node.value.type === 'JSXExpressionContainer'
            ? renderedStrings(node.value.expression)
            : renderedStrings(node.value);
        for (const literal of strings) report(literal, context.sourceCode.getText(literal));
      },
    };
  },
};
