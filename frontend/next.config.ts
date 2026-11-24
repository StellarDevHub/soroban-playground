import type { NextConfig } from "next";

// ---------------------------------------------------------------------------
// Bundle analyser — optional dev/CI dependency, gracefully absent in prod.
// ---------------------------------------------------------------------------
let withBundleAnalyzer: (opts: object) => (cfg: NextConfig) => NextConfig = (
  _opts,
) => (cfg) => cfg;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  withBundleAnalyzer = require("@next/bundle-analyzer");
} catch {
  // package not installed — no-op wrapper is used instead
}

/**
 * Static security headers for the Playground (#1540).
 *
 * `Content-Security-Policy` is deliberately *not* set here. It is applied by
 * `src/proxy.ts` (the Next.js 16 successor to `src/middleware.ts`) instead,
 * because the policy omits `'unsafe-inline'` and therefore has to carry a nonce
 * that changes on every response; `headers()` is evaluated once at build time
 * and cannot do that. The two escape hatches it keeps (`'wasm-unsafe-eval'` for
 * the WASM inspector and in-browser rustfmt, and `'unsafe-eval'` for the pinned
 * `monaco-languageclient` workers) are documented on `buildContentSecurityPolicy`.
 *
 * The headers below need no per-response value, so keeping them here means they
 * still apply to any route the proxy might not match.
 */
const SECURITY_HEADERS = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Required for Monaco language-server workers to use SharedArrayBuffer.
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // Pinned to `0`: the modern control is the CSP nonce; the old `1; mode=block`
  // mode can itself introduce a vulnerability.
  { key: "X-XSS-Protection", value: "0" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const isProd = process.env.NODE_ENV === "production";
const analyze = process.env.ANALYZE_BUNDLE === "true";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Omit source maps from production pages bundle — reduces attack surface and
  // first-load JS weight.
  productionBrowserSourceMaps: false,

  compiler: {
    // Strip console.* calls in production (keep error/warn for incident triage).
    removeConsole: isProd ? { exclude: ["error", "warn"] } : false,
  },

  // ---------------------------------------------------------------------------
  // Image optimisation
  // ---------------------------------------------------------------------------
  images: {
    formats: ["image/avif", "image/webp"],
    unoptimized: false,
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },

  // ---------------------------------------------------------------------------
  // Turbopack (next dev --turbopack)
  //
  // `wabt` is an Emscripten build that statically references Node's `fs` inside
  // a branch guarded by `ENVIRONMENT_IS_NODE`. The webpack `resolve.fallback`
  // below never applies under Turbopack, so alias `fs` to an empty shim for
  // browser bundles. Server bundles keep the real module.
  // ---------------------------------------------------------------------------
  turbopack: {
    resolveAlias: {
      fs: { browser: "./empty-module.js" },
    },
  },

  // ---------------------------------------------------------------------------
  // HTTP headers
  // ---------------------------------------------------------------------------
  async headers() {
    return [
      // Immutable CDN cache for Next.js static assets.
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      // Immutable CDN cache for /static/* assets.
      {
        source: "/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      // All other routes — security headers + short CDN TTL.
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, s-maxage=86400",
          },
          ...SECURITY_HEADERS,
        ],
      },
    ];
  },

  // ---------------------------------------------------------------------------
  // Rewrites — proxy /api/* to the backend at build/runtime.
  // ---------------------------------------------------------------------------
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";
    if (!apiBase) return { beforeFiles: [] };

    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${apiBase}/api/:path*`,
        },
      ],
    };
  },

  // ---------------------------------------------------------------------------
  // Package-import tree-shaking
  // ---------------------------------------------------------------------------
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "date-fns",
      "@apollo/client",
      "graphql",
      "rxjs",
      "react-window",
      "chart.js",
      "react-chartjs-2",
      "reactflow",
    ],
  },

  // ---------------------------------------------------------------------------
  // Runtime environment defaults
  // ---------------------------------------------------------------------------
  env: {
    NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK ?? "testnet",
  },

  // ---------------------------------------------------------------------------
  // Webpack
  // ---------------------------------------------------------------------------
  webpack(config, { isServer }) {
    // Enable async WASM — required for the in-browser Soroban inspector.
    config.experiments = { ...config.experiments, asyncWebAssembly: true };

    if (!isServer) {
      // Polyfill Node built-ins that some packages import statically.
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };

      // Split large vendor libraries into dedicated async chunks so they do not
      // count against the first-load JS budget.
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: "all",
          minSize: 20_000,
          maxInitialRequests: 25,
          maxAsyncRequests: 25,
          cacheGroups: {
            // Catch-all vendor group.
            defaultVendors: {
              test: /[\\/]node_modules[\\/]/,
              priority: 10,
              reuseExistingChunk: true,
            },
            // Monaco editor — only needed in the editor view.
            monacoEditor: {
              test: /[\\/]node_modules[\\/](@monaco-editor|monaco-editor|monaco-languageclient|@tags)[\\/]/,
              name: "monaco-editor",
              chunks: "all",
              priority: 30,
              enforce: true,
              reuseExistingChunk: true,
            },
            // Charting libraries — lazy-loaded with dashboard widgets.
            chartJs: {
              test: /[\\/]node_modules[\\/](@kurkle[\\/]color|chart\.js|react-chartjs-2)[\\/]/,
              name: "chartjs",
              chunks: "all",
              priority: 25,
              enforce: true,
              reuseExistingChunk: true,
            },
            // ReactFlow — only used in the flow builder.
            flowDiagram: {
              test: /[\\/]node_modules[\\/](reactflow|@reactflow|@xyflow)[\\/]/,
              name: "reactflow",
              chunks: "all",
              priority: 20,
              enforce: true,
              reuseExistingChunk: true,
            },
            // Stellar SDK + WASM tooling — only needed during chain interactions.
            stellar: {
              test: /[\\/]node_modules[\\/](@stellar[\\/]|wabt|rustfmt)[\\/]/,
              name: "stellar",
              priority: 20,
              reuseExistingChunk: true,
            },
          },
        },
      };
    }

    // Disable source maps in production to avoid leaking source.
    if (isProd) {
      config.devtool = false;
    }

    // Bundle analyser — activated by ANALYZE_BUNDLE=true (CI or local).
    if (analyze) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { BundleAnalyzerPlugin } = require("webpack-bundle-analyzer");
      config.plugins = config.plugins ?? [];
      config.plugins.push(
        new BundleAnalyzerPlugin({
          analyzerMode: "static",
          openAnalyzer: false,
          generateStatsFile: true,
          statsFilename: "stats.json",
        }),
      );
    }

    return config;
  },
};

export default withBundleAnalyzer({
  enabled: analyze,
  openAnalyzer: false,
  analyzerMode: "static",
  logLevel: "info",
})(nextConfig);
