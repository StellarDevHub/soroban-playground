const path = require("path");

module.exports = { 
  entry: "./src/workers/rustAnalyzer.worker.ts",
  output: {
    path: path.resolve(__dirname, "public/workers"),
    filename: "rustAnalyzer.worker.js",
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-react", "@babel/preset-typescript"],
          },
        },
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
};
