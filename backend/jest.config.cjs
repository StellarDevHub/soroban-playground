module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js', '**/tests/syntheticAssets.*.test.js'],
  modulePaths: [path.resolve(__dirname, '../node_modules')],
  transform: {
    '^.+\\.js$': ['babel-jest', { configFile: './babel.config.cjs' }]
  },
  extensionsToTreatAsEsm: ['.js'],
  transformIgnorePatterns: [],
  nodeOptions: ['--experimental-vm-modules']
};
