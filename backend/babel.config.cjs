const path = require('path');

function resolveLocalModule(name) {
  for (const modulesPath of [
    path.resolve(__dirname, 'node_modules'),
    path.resolve(__dirname, '../node_modules'),
  ]) {
    try {
      return require(path.join(modulesPath, name));
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }

  return require(name);
}

module.exports = {
  presets: [
    [resolveLocalModule('@babel/preset-env'), { targets: { node: 'current' } }],
  ],
  plugins: [resolveLocalModule('babel-plugin-transform-import-meta')],
};
