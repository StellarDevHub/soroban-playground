// Tests for the GraphQL query depth limiter (issue #1769).
// Covers: plain nesting, fragments and inline fragments, fragment cycles,
// introspection exemption, and the MAX_DEPTH boundary.

import { createRequire } from 'module';
import { computeDepth, MAX_DEPTH } from '../src/graphql/depth.js';

const nodeRequire = createRequire(import.meta.url);
const { parse } = nodeRequire('graphql');

const depthOf = (query) => computeDepth(parse(query));

// Builds `{ a { a { ... a } } }` with `levels` nested fields.
const nested = (levels) =>
  '{ ' + 'a { '.repeat(levels - 1) + 'a' + ' }'.repeat(levels - 1) + ' }';

describe('computeDepth', () => {
  it('counts a scalar top-level field as depth 1', () => {
    expect(depthOf('{ health }')).toBe(1);
  });

  it('counts nested selection sets', () => {
    expect(depthOf('{ projects { files { name } } }')).toBe(3);
  });

  it('returns the deepest branch', () => {
    expect(depthOf('{ health projects { id files { name } } }')).toBe(3);
  });

  it('expands named fragments in place', () => {
    const query = `
      query { projects { ...ProjectFields } }
      fragment ProjectFields on Project { files { name } }
    `;
    expect(depthOf(query)).toBe(3);
  });

  it('does not add a level for inline fragments', () => {
    expect(depthOf('{ projects { ... on Project { files { name } } } }')).toBe(3);
  });

  it('terminates on fragment cycles', () => {
    const query = `
      query { projects { ...A } }
      fragment A on Project { files { ...B } }
      fragment B on File { project { ...A } }
    `;
    expect(depthOf(query)).toBe(3);
  });

  it('ignores introspection fields', () => {
    const query = '{ __schema { types { fields { type { ofType { ofType { name } } } } } } }';
    expect(depthOf(query)).toBe(0);
  });

  it('takes the deepest of several operations', () => {
    expect(depthOf('query A { health } query B { projects { id } }')).toBe(2);
  });
});

describe('MAX_DEPTH boundary', () => {
  it('is 6 levels', () => {
    expect(MAX_DEPTH).toBe(6);
  });

  it('allows a query exactly at the limit', () => {
    expect(depthOf(nested(MAX_DEPTH))).toBe(MAX_DEPTH);
  });

  it('flags a query one level past the limit', () => {
    expect(depthOf(nested(MAX_DEPTH + 1))).toBeGreaterThan(MAX_DEPTH);
  });
});
