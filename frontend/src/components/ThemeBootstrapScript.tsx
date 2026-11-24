import { headers } from "next/headers";
import { CSP_HEADER, extractNonce } from "@/lib/securityHeaders";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme/engine";

/**
 * Applies the stored / OS theme before first paint so a returning visitor never
 * sees a flash of the default palette (FRONTEND-282 zero-FOUC requirement).
 *
 * The script writes semantic theme values (--bg-primary, --text-primary, ...)
 * as CSS custom properties on <html> synchronously, before the body is parsed,
 * so every component bound to those variables renders in the correct palette
 * on the very first paint. The High Contrast (WCAG AAA) palette is selected
 * through the same bootstrap path.
 *
 * This lives in its own component rather than inline in the root layout
 * because reading the nonce requires `headers()`, which makes the component
 * async - and an async root layout is not a valid client component. Keeping the
 * async boundary narrow also means the rest of the layout stays synchronous.
 *
 * #1540: the CSP set by `middleware.ts` omits `'unsafe-inline'`, so this inline
 * script only executes when it carries the same nonce as the response policy.
 * The nonce arrives through the request header that middleware set, which is the
 * same value Next.js stamps onto its own bootstrap scripts. When middleware did
 * not run (a static export, say) `extractNonce` returns null and the prop is
 * omitted rather than set to a placeholder that could never match.
 */
export default async function ThemeBootstrapScript() {
  const nonce = extractNonce((await headers()).get(CSP_HEADER));

  return (
    <script
      nonce={nonce ?? undefined}
      dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
    />
  );
}
