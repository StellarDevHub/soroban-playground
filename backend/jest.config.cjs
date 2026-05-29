module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.js$': ['babel-jest', { configFile: './babel.config.cjs' }]
  },
  extensionsToTreatAsEsm: ['.js'],
  transformIgnorePatterns: [],
  nodeOptions: ['--experimental-vm-modules']
};
