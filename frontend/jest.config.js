/** @type {import('jest').Config} */
const path = require("path");
const fs = require("fs");

// Absolute path to the frontend's own node_modules — used to resolve packages
// that are NOT hoisted to the workspace root (e.g. react, react-dom).
const frontendModules = path.resolve(__dirname, "node_modules");

// Absolute path to the workspace root node_modules — used to resolve packages
// that ARE hoisted (e.g. jest, jest-environment-jsdom, @testing-library/*).
const rootModules = path.resolve(__dirname, "../node_modules");
const resolveWorkspacePackage = (name) => {
  const frontendPackage = path.resolve(frontendModules, name);
  return fs.existsSync(frontendPackage)
    ? frontendPackage
    : path.resolve(rootModules, name);
};

const config = {
  testEnvironment: "jsdom",
  testPathIgnorePatterns: ["/node_modules/", "\\.node\\.test\\.ts$"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // Pin react and react-dom to the frontend's copy.
    // This ensures root-hoisted packages like @testing-library/react can find React.
    "^react$": resolveWorkspacePackage("react"),
    "^react/(.*)$": `${resolveWorkspacePackage("react")}/$1`,
    "^react-dom$": resolveWorkspacePackage("react-dom"),
    "^react-dom/(.*)$": `${resolveWorkspacePackage("react-dom")}/$1`,
    "\\.(css|less|scss|sass)$": "identity-obj-proxy",
  },
  // Resolve modules from both the frontend and the workspace root.
  modulePaths: [frontendModules, rootModules],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "babel-jest",
      {
        presets: [
          ["@babel/preset-react", { runtime: "automatic" }],
          "@babel/preset-typescript",
        ],
        plugins: [
          "@babel/plugin-transform-dynamic-import",
          "@babel/plugin-transform-modules-commonjs",
          "babel-plugin-transform-import-meta",
        ],
      },
    ],
    "^.+\\.js$": [
      "babel-jest",
      {
        plugins: [
          "@babel/plugin-transform-dynamic-import",
          "@babel/plugin-transform-modules-commonjs",
          "babel-plugin-transform-import-meta",
        ],
      },
    ],
  },
  transformIgnorePatterns: ["/node_modules/(?!(lucide-react)/)"],
};

module.exports = config;
