/**
 * Content-Security-Policy construction for the Playground (#1540).
 *
 * The policy is built here rather than inlined in `next.config.ts` so that the
 * nonce can be minted per request by `proxy.ts` and so the resulting
 * policy is unit-testable without booting Next.
 *
 * ## Why a nonce and not `'unsafe-inline'`
 *
 * The previous policy shipped `'unsafe-inline' 'unsafe-eval'` in `script-src`.
 * That permits an injected `<script>` (or `eval()`) to execute even when the
 * markup that carried it was sanitized, which silently undid the boundary that
 * `lib/sanitize.ts` establishes. Removing `'unsafe-inline'` is only safe if every
 * inline script the app actually emits carries a matching nonce, so the policy
 * keeps `'strict-dynamic'` and relies on the nonce rather than on a wildcard.
 *
 * The nonce must be unpredictable and per response. A hard-coded value would be
 * a constant that any attacker can read off the page, so `generateNonce` must
 * only ever be called on the server.
 */

/** WebAssembly and worker escape hatches that genuinely cannot be removed. */
const SCRIPT_ESCAPE_HATCHES = ["'wasm-unsafe-eval'", "'unsafe-eval'"];

/**
 * Build the full policy for one response.
 *
 * @param nonce base64 nonce shared with the request's inline scripts. When
 *   omitted the policy falls back to `'unsafe-inline'`, which is correct only
 *   for environments where the proxy does not run (e.g. a static export) and
 *   is always the weaker option.
 */
export function buildContentSecurityPolicy(nonce?: string): string {
  const scriptSrc = [
    "'self'",
    "'strict-dynamic'",
    ...(nonce ? [`'nonce-${nonce}'`] : ["'unsafe-inline'"]),
    ...SCRIPT_ESCAPE_HATCHES,
    "https://cdn.jsdelivr.net",
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    // Inline styles stay permitted because Tailwind v4 and Monaco both inject
    // style attributes. `style-src-attr` is separated so a future tightening
    // pass can drop attributes on their own.
    "style-src 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
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
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** Header name used for both the request hint and the response policy. */
export const CSP_HEADER = "Content-Security-Policy";

/**
 * Cryptographically random, base64-encoded nonce.
 *
 * Uses the Web Crypto CSPRNG (`crypto.getRandomValues`), which is available on
 * both the Edge and Node runtimes, so no Node-only `crypto` module is needed.
 * Server-only: the value is echoed into HTML.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

/**
 * Recover the nonce that a policy already carries.
 *
 * `proxy.ts` writes the policy onto the *request* headers as well as the
 * response, which is how Next.js discovers the nonce for the scripts it injects.
 * The root layout reads it back through `headers()` to nonce its own inline
 * script. Returns `null` when no nonce is present, so callers can degrade
 * instead of emitting `nonce="undefined"`.
 */
export function extractNonce(policy: string | null | undefined): string | null {
  if (!policy) {
    return null;
  }

  const match = /'nonce-([^']+)'/.exec(policy);
  return match ? match[1] : null;
}
