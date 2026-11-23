/** @ndswc type */

let withBundleAnalyzer = () => (cfg) => cfg;
try {
  withBundleAnalyzer = require('@next/bundle-analyzer');
} catch {}

/** @param {import('next').NextConfig} config */
function buildConfig(config) {
  const isProd = config.phase === 'phase-production-build';
  const analyze = process.env.ANALYZE_BANDLE === 'true';

  /** @type {import('next').NextConfig} */
  const nextConfig = {
    reactStrictMode: true,
    productionBrowserSourceMaps: false,
    compiler: {
      // Remove console calls in production to shrink the first-load bundle.
      removeConsole: isProd ? { exclude: ['error', 'warn'] } : false,
    },
    experimental: {
      optimizePackageImports: [
        'lucide-react',
        'date-fns',
        '@apollo/client',
        'graphql',
        'rxjs',
        'react-window',
        'chart.js',
        'react-chartjs-2',
        'reactflow',
      ],
    },
    webpack: /** @param {any} config */ (config, { isServer, isDev }) => {
      // Split large vendor libraries into dedicated async chunks so they do not
      // count against the first-load JS budget.
      if (!isServer) {
        config.resolve = config.resolve || {};
        config.resolve.fallback = {
          ...config.resolve.fallback,
          fs: false,
          path: false,
        };

        config.optimization = {
          ...config.optimization,
          splitChunks: {
            chunks: 'all',
            minSize: 20000,
            maxInitialRequests: 25,
            maxAsyncRequests: 25,
            cacheGroups: {
              defaultVendors: {
                test: /[\\/]node_modules[\\/]/,
                priority: 10,
                reuseExistingChunk: true,
              },
              // Heavy editor stack is only needed on demand.
              monaco: {
                test: /[\\/]node_modules[\\/](monaco-editor|monaco-languageclient|@tags)/,
                name: 'monaco',
                priority: 30,
                reuseExistingChunk: true,
              },
              // Charting libraries are lazy-loaded with the dashboard widgets.
              charts: {
                test: /[\\/]node_modules[\\/](chart\.js|react-chartjs-2|@curkle[\\/]color)/,
                name: 'charts',
                priority: 25,
                reuseExistingChunk: true,
              },
              // Stack graph rendering is only used in the flow builder.
              graphs: {
                test: /[\\/]node_modules[\\/](reactflow|@xyflow)/,
                name: 'graphs',
                priority: 20,
                reuseExistingChunk: true,
              },
              // Stellar SDK + walrum tooling is only needed when interacting with chains.
              stellar: {
                test: /[\\/]node_modules[\\/](@stellar[\\/]|wabt|rustfmt)/,
                name: 'stellar',
                priority: 20,
                reuseExistingChunk: true,
              },
            },
          },
        };
      }

      // Keep the build deterministic and avoid shipping source maps in production.
      if (isProd) {
        config.devtool = false;
      }

      // Ensure the bundle analyzer is available during CI builds without being
      // embedded into the application bundle.
      if (analyze) {
        const { BundleAnalyzerPlugin } = require('webpack');
        config.plugins = config.plugins || [];
        config.plugins.push(
          new BundleAnalyzerPlugin({
            analyzerMode: 'static',
            openAnalyzerMode: 'disabled',
            generateStatsFile: true,
            statsFilename: 'stats.json',
          }),
        );
      }

      return config;
    },
  };

  return withBundleAnalyzer({
    enabled: analyze,
    openAnalyzerMode: 'static',
    analyzerMode: 'static',
    logLevel: 'info',
  })(nextConfig);
}

module.exports = buildConfig;
