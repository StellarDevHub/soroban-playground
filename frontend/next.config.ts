import type { NextConfig } from "next";

/**
 * Static security headers for the Playground (#1540).
 *
 * `Content-Security-Policy` is deliberately *not* set here. It is applied by
 * `src/middleware.ts` instead, because the policy omits `'unsafe-inline'` and
 * therefore has to carry a nonce that changes on every response; `headers()` is
 * evaluated once at build time and cannot do that. The two escape hatches it
 * keeps (`'wasm-unsafe-eval'` for the WASM inspector and in-browser rustfmt, and
 * `'unsafe-eval'` for the pinned `monaco-languageclient` workers) are documented
 * on `buildContentSecurityPolicy`.
 *
 * The headers below need no per-response value, so keeping them here means they
 * still apply to any route middleware might not match.
 */
const STATIC_SECURITY_HEADERS = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Required for the Monaco language-server workers to use SharedArrayBuffer.
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
  // Legacy auditor header. Pinned to `0` because the modern, auditable control
  // is the CSP; leaving this unset trips a filter-bypass warning in scanners,
  // and the old `1; mode=block` mode can itself introduce a vulnerability.
  { key: "X-XSS-Protection", value: "0" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      // `wabt` is an Emscripten build that statically references Node's `fs`
      // inside a branch guarded by `ENVIRONMENT_IS_NODE`. The webpack fallback
      // below never applies under Turbopack, so alias `fs` to an empty shim for
      // browser bundles. Server bundles keep the real module.
      fs: { browser: "./empty-module.js" },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: STATIC_SECURITY_HEADERS,
      },
    ];
  },
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          ...config.optimization?.splitChunks,
          cacheGroups: {
            ...config.optimization?.splitChunks?.cacheGroups,
            monacoEditor: {
              test: /[\\/]node_modules[\\/](@monaco-editor|monaco-editor|monaco-languageclient)[\\/]/,
              name: "monaco-editor",
              chunks: "all",
              priority: 30,
              enforce: true,
            },
            chartJs: {
              test: /[\\/]node_modules[\\/](@kurkle|chart\.js|react-chartjs-2)[\\/]/,
              name: "chartjs",
              chunks: "all",
              priority: 30,
              enforce: true,
            },
            flowDiagram: {
              test: /[\\/]node_modules[\\/](reactflow|@reactflow)[\\/]/,
              name: "reactflow",
              chunks: "all",
              priority: 29,
              enforce: true,
            },
            stellarSdk: {
              test: /[\\/]node_modules[\\/]@stellar[\\/]stellar-sdk[\\/]/,
              name: "stellar-sdk",
              chunks: "all",
              priority: 28,
              enforce: true,
            },
            stellarWalletsKit: {
              test: /[\\/]node_modules[\\/]@creit\.tech[\\/]stellar-wallets-kit[\\/]/,
              name: "stellar-wallets-kit",
              chunks: "all",
              priority: 28,
              enforce: true,
            },
          },
        },
      };
    }

    return config;
  },
};

export default nextConfig;
