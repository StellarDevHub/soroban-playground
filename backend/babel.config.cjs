const path = require('path');
const localModules = path.resolve(__dirname, '../node_modules');

function requireFromBackendFirst(packageName) {
  try {
    return require(require.resolve(packageName, { paths: [__dirname] }));
  } catch {
    return require(
      require.resolve(packageName, {
        paths: [path.resolve(__dirname, '../node_modules')],
      })
    );
  }
}

function resolveBabelModule(name) {
  return require.resolve(name, { paths: [__dirname, localModules] });
}

module.exports = {
  presets: [
    [
      resolveBabelModule('@babel/preset-env'),
      { targets: { node: 'current' }, modules: 'auto' },
    ],
    [
      resolveBabelModule('@babel/preset-typescript'),
      { allExtensions: true, isTSX: false },
    ],
  ],
  plugins: [resolveBabelModule('babel-plugin-transform-import-meta')],
};
