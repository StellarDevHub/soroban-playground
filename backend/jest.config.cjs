const path = require('path');

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js', '**/tests/syntheticAssets.*.test.js'],
  modulePaths: [path.resolve(__dirname, '../node_modules')],
  transform: {
    '^.+\\.js$': [
      'babel-jest',
      {
        configFile: path.resolve(__dirname, 'babel.config.cjs'),
      },
    ],
  },
  moduleNameMapper: {
    '^../src/services/dbService\\.js$': path.resolve(
      __dirname,
      'src/services/__mocks__/dbService.js'
    ),
    '^./dbService\\.js$': path.resolve(
      __dirname,
      'src/services/__mocks__/dbService.js'
    ),
    '^../src/services/databaseService\\.js$': path.resolve(
      __dirname,
      'src/services/__mocks__/databaseService.js'
    ),
    '^./databaseService\\.js$': path.resolve(
      __dirname,
      'src/services/__mocks__/databaseService.js'
    ),
  },
  globals: {
    'babel-jest': {
      useESM: true,
    },
  },
  transformIgnorePatterns: [],
};
