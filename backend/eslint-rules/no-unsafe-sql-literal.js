/**
 * ESLint rule: disallow dynamic SQL string interpolation outside allowlisted maps.
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow template literal interpolation inside SQL-looking strings',
    },
    schema: [],
    messages: {
      unsafeSql:
        'Avoid embedding expressions in SQL strings. Use bound parameters (?) instead.',
    },
  },
  create(context) {
    function checkTemplateLiteral(node) {
      if (!node.expressions || node.expressions.length === 0) return;

      const quasiText = node.quasis.map((q) => q.value.raw).join(' ');
      const looksLikeSql =
        /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|ORDER BY)\b/i.test(
          quasiText
        );
      if (!looksLikeSql) return;

      const isAllowlistedSortMap =
        /sortMapping|ORDER_OPTIONS|SORT_OPTIONS|sortOptions/i.test(
          context.getSourceCode().getText(node.parent || node)
        );
      if (isAllowlistedSortMap) return;

      context.report({ node, messageId: 'unsafeSql' });
    }

    return {
      TemplateLiteral: checkTemplateLiteral,
    };
  },
};

export default rule;
