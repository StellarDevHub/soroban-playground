/** @type {import('@babel/core').TransformOptions} */
module.exports = {
  // Use the commonjs plugin directly instead of @babel/preset-env to avoid
  // the workspace lru-cache resolution conflict while still converting
  // ESM import/export → require/module.exports for CJS Jest.
  plugins: ['@babel/plugin-transform-modules-commonjs'],
  presets: [
    // Strip TypeScript type annotations.
    '@babel/preset-typescript',
    // Transform JSX to React.createElement with the new automatic runtime.
    ['@babel/preset-react', { runtime: 'automatic' }],
  ],
};
