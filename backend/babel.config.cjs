const path = require('path');

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
<<<<<<< HEAD
    [
      requireFromBackendFirst('@babel/preset-env'),
      { targets: { node: 'current' } },
    ],
  ],
  plugins: [requireFromBackendFirst('babel-plugin-transform-import-meta')],
=======
    [resolveBabelModule('@babel/preset-env'), { targets: { node: 'current' } }],
  ],
  plugins: [resolveBabelModule('babel-plugin-transform-import-meta')],
>>>>>>> origin/main
};
