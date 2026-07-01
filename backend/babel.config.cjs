const path = require('path');
const localModules = path.resolve(__dirname, '../node_modules');

function resolveBabelModule(name) {
  return require.resolve(name, { paths: [__dirname, localModules] });
}

module.exports = {
  presets: [
    [resolveBabelModule('@babel/preset-env'), { targets: { node: 'current' } }],
  ],
  plugins: [resolveBabelModule('babel-plugin-transform-import-meta')],
};
