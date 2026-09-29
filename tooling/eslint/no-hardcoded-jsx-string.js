// M5-10: UI text comes from the i18n catalog, so JSX must not contain hardcoded strings.
// Reports JSX text, string literals rendered as children, and strings in attributes the
// user sees or hears. Text without letters (whitespace, punctuation, numbers) is allowed.

const hasLetter = (/** @type {string} */ text) => /\p{L}/u.test(text);

// Attributes whose value is shown to the user or read by a screen reader. `children` is the
// prop spelling of rendered content.
const uiAttributes = new Set([
  'alt',
  'aria-description',
  'aria-keyshortcuts',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'children',
  'label',
  'placeholder',
  'title',
]);

// `<input type="submit" value="Save" />`: for these input types `value` is the visible label.
// For other inputs and elements it's form data.
const labelledInputTypes = new Set(['submit', 'button', 'reset']);

/** @param {any} attribute JSXAttribute */
function isInputLabel(attribute) {
  const element = attribute.parent;
  if (element?.name?.type !== 'JSXIdentifier' || element.name.name !== 'input') return false;
  const type = element.attributes.find(
    (/** @type {any} */ a) => a.type === 'JSXAttribute' && a.name.name === 'type',
  );
  // `type="submit"` or `type={'submit'}`; HTML keywords are case-insensitive.
  const value =
    type?.value?.type === 'JSXExpressionContainer' ? type.value.expression : type?.value;
  return (
    value?.type === 'Literal' &&
    typeof value.value === 'string' &&
    labelledInputTypes.has(value.value.toLowerCase())
  );
}

/**
 * String literals an expression can evaluate to or contain, looking through conditionals,
 * logical operators, concatenation, arrays and TypeScript wrappers (`x ? 'a' : b`, `x && 'a'`,
 * `'a ' + x`, `['a']`, `'a' as const`).
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
        : node.expressions.flatMap((/** @type {any} */ e) => renderedStrings(e));
    case 'ConditionalExpression':
      return [...renderedStrings(node.consequent), ...renderedStrings(node.alternate)];
    case 'LogicalExpression':
      return [...renderedStrings(node.left), ...renderedStrings(node.right)];
    case 'ArrayExpression':
      return node.elements.flatMap((/** @type {any} */ e) => renderedStrings(e));
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'TSTypeAssertion':
      return renderedStrings(node.expression);
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
        if (!(uiAttributes.has(name) || (name === 'value' && isInputLabel(node)))) return;
        if (node.value === null) return;
        const strings =
          node.value.type === 'JSXExpressionContainer'
            ? renderedStrings(node.value.expression)
            : renderedStrings(node.value);
        for (const literal of strings) report(literal, context.sourceCode.getText(literal));
      },
    };
  },
};
