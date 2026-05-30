module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' }, modules: 'auto' }],
  ],
  plugins: [
    'babel-plugin-transform-import-meta',
    '@babel/plugin-syntax-import-meta',
    '@babel/plugin-transform-modules-commonjs',
  ],
};
