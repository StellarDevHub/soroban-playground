/** @type {import('jest').Config} */
const path = require('path');

// Absolute path to the frontend's own node_modules — used to resolve packages
// that are NOT hoisted to the workspace root (e.g. react, react-dom).
const frontendModules = path.resolve(__dirname, 'node_modules');

// Absolute path to the workspace root node_modules — used to resolve packages
// that ARE hoisted (e.g. jest, jest-environment-jsdom, @testing-library/*).
const rootModules = path.resolve(__dirname, '../node_modules');

const config = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Pin react and react-dom to the frontend's copy.
    // This ensures root-hoisted packages like @testing-library/react can find React.
    '^react$': path.resolve(frontendModules, 'react'),
    '^react/(.*)$': path.resolve(frontendModules, 'react/$1'),
    '^react-dom$': path.resolve(frontendModules, 'react-dom'),
    '^react-dom/(.*)$': path.resolve(frontendModules, 'react-dom/$1'),
  },
  // Resolve modules from both the frontend and the workspace root.
  modulePaths: [frontendModules, rootModules],
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
