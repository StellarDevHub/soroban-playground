const path = require('path');
const localModules = path.resolve(__dirname, '../node_modules');

module.exports = {
  presets: [
    [
      require(path.join(localModules, '@babel/preset-env')),
      { targets: { node: 'current' } },
    ],
  ],
  plugins: [require(path.join(localModules, 'babel-plugin-transform-import-meta'))],
};
