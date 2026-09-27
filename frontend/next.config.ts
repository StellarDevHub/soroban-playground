import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data: https://fonts.gstatic.com",
              [
                "connect-src 'self'",
                "https://soroban-playground.onrender.com",
                "wss://soroban-playground.onrender.com",
                "https://*.onrender.com",
                "wss://*.onrender.com",
                "https://soroban-testnet.stellar.org",
                "https://soroban-mainnet.stellar.org",
                "https://horizon-testnet.stellar.org",
                "https://horizon.stellar.org",
                "https://*.stellar.org",
                "wss:",
                "ws:",
                "http://localhost:*",
                "ws://localhost:*",
                process.env.NEXT_PUBLIC_API_BASE_URL,
                process.env.NEXT_PUBLIC_BACKEND_URL,
                process.env.NEXT_PUBLIC_API_URL,
              ]
                .filter(Boolean)
                .join(" "),
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
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
              test: /[\\/]node_modules[\\/](@monaco-editor|monaco-editor)[\\/]/,
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
          },
        },
      };
    }

    return config;
  },
};

export default nextConfig;
