/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['babel-jest', {
      presets: [
        ['@babel/preset-react', { runtime: 'automatic' }],
        '@babel/preset-typescript',
      ],
      plugins: ['@babel/plugin-transform-modules-commonjs'],
    }],
    '^.+\\.js$': ['babel-jest', {
      plugins: ['@babel/plugin-transform-modules-commonjs'],
    }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(lucide-react)/)',
  ],
};

module.exports = config;
