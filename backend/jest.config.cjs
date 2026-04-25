const path = require('path');

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  modulePaths: [path.resolve(__dirname, '../node_modules')],
  transform: {
    '^.+\\.js$': [
      'babel-jest',
      { configFile: path.resolve(__dirname, 'babel.config.cjs') },
    ],
  },
};
