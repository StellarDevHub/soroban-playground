## Build Optimization Plan

### Identified Issues
- Deprecated `whatwg-encoding` package (replace with `@exodus/bytes`)
- Outdated `@types/react-window` type definitions
- Annual Next.js telemetry opt-in UI

### Recommended Actions
1. Update dependencies:
   - Replace `whatwg-encoding` with `@exodus/bytes` (warning suggests this is faster and spec-compliant)
   - Remove `react-window` types (user-provided definitions exist)
   - Run `npm install` to apply updates
2. Address telemetry:
   - Review opt-in URL ([nextjs.org/telemetry](https://nextjs.org/telemetry)) to confirm consent status
   - Update Vercel config if telemetry needs to be disabled
3. Run lint/verify:
   - Execute `npm run lint` and `npm run typecheck` to validate changes
4. Rebuild and test:
   - Run `vercel build` again to verify fix

### Prerequisites
- Ensure npm is updated to latest version
- Confirm project dependencies are compatible with Next.js 16.2.6

### Deliverables
- Clean build with no deprecation warnings
- Updated dependency manifests (`package.json`)
- Telemetry configuration confirmed

### Owner
Kilo<br>Plan Date: 2026-06-12