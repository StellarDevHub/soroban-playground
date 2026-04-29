# System Architecture

## Overview

Soroban Playground is designed as a scalable, developer-friendly monorepo, splitting responsibilities between a React/Next.js frontend and a Node.js Express backend.

## Frontend Architecture (Next.js)
- **Monaco Editor**: Handles high-performance code editing with Rust syntax highlighting.
- **State Management**: React Hooks (`useState`, `useEffect`) manage the workflow states (`isCompiling`, `isDeploying`) and store the ephemeral contract information (Simulator vs Live).
- **Styling**: TailwindCSS provides a modern, dark-themed responsive layout out-of-the-box.
- **API Interactions**: The frontend communicates via REST JSON endpoints provided by the backend.
- **Yield Optimizer Dashboard**: A dedicated route (`/yield-optimizer`) for strategy management, deposit/withdraw flows, auto-compound controls, and deterministic backtesting results.

## Backend Architecture (Node.js/Express)
- **Compilation Engine**: Uses Node.js `child_process` (`exec`) to run `cargo build --target wasm32-unknown-unknown` against temporary scoped directories.
- **Deployment Engine**: Invokes the `soroban contract deploy` CLI command, returning the `Contract ID`.
- **Invocation Engine**: Invokes the `soroban contract invoke` CLI command to read/write state based on frontend form inputs.
- **Yield Optimizer Service**: In-memory strategy engine with share accounting, role-gated compounding, dashboard metrics, and deterministic strategy backtesting.

## Yield Optimizer Feature Slice

- Contract: `contracts/yield-optimizer`
- Backend APIs: `backend/src/routes/optimizer.js`
- Backend service: `backend/src/services/yieldOptimizerService.js`
- Frontend page: `frontend/src/app/yield-optimizer/page.tsx`
- Frontend client: `frontend/src/services/yieldOptimizerService.ts`

The design intentionally avoids real external DeFi integrations in this MVP. Protocol names are metadata strings so contributors can later wire adapters without breaking API or contract flows.

![Architecture Diagram](./architecture.png)

```mermaid
graph TD;
    User-->Frontend;
    Frontend-->|/api/compile|Backend;
    Frontend-->|/api/deploy|Backend;
    Frontend-->|/api/invoke|Backend;
    Backend-->|cargo build|WASM;
    Backend-->|soroban-cli|StellarTestnet;
    StellarTestnet-->Backend;
    Backend-->Frontend;
```

## Scaling Considerations (For Future Updates)
- Use **Docker Containers** instead of raw `child_process` for secure compilation environments on a live server.
- Introduce a Database (PostgreSQL/Redis) to store user sessions and save shareable playground environments.
