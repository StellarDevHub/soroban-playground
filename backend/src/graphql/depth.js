// Query depth limiting (issue #1769).
// Rejects documents nested deeper than MAX_DEPTH selection levels, before any
// resolver runs. Fragments are expanded in place; introspection fields
// (`__schema`, `__type`, ...) are ignored so GraphiQL keeps working.

export const MAX_DEPTH = 6;

function selectionDepth(selectionSet, fragments, visited) {
  if (!selectionSet) return 0;
  let max = 0;
  for (const selection of selectionSet.selections) {
    let depth = 0;
    if (selection.kind === 'Field') {
      if (selection.name.value.startsWith('__')) continue;
      depth = selection.selectionSet
        ? 1 + selectionDepth(selection.selectionSet, fragments, visited)
        : 1;
    } else if (selection.kind === 'InlineFragment') {
      depth = selectionDepth(selection.selectionSet, fragments, visited);
    } else if (selection.kind === 'FragmentSpread') {
      const name = selection.name.value;
      // A fragment cycle is a validation error elsewhere; don't recurse forever.
      if (visited.has(name) || !fragments[name]) continue;
      visited.add(name);
      depth = selectionDepth(fragments[name].selectionSet, fragments, visited);
      visited.delete(name);
    }
    if (depth > max) max = depth;
  }
  return max;
}

/**
 * Returns the deepest operation's field depth in a parsed document. A
 * top-level field with scalar output (`{ health }`) has depth 1.
 */
export function computeDepth(document) {
  const fragments = {};
  for (const def of document.definitions) {
    if (def.kind === 'FragmentDefinition') fragments[def.name.value] = def;
  }
  let max = 0;
  for (const def of document.definitions) {
    if (def.kind !== 'OperationDefinition') continue;
    max = Math.max(max, selectionDepth(def.selectionSet, fragments, new Set()));
  }
  return max;
}
