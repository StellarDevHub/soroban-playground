# Soroban Playground

Soroban Playground is a browser-based IDE for writing, compiling, deploying, and interacting with Stellar Soroban smart contracts.
No setup required. Write Rust smart contracts directly in your browser.

## Features
- **Code Editor**: Monaco-based editor with Rust syntax highlighting, auto-formatting, and contract templates.
- **In-browser Compilation**: Compile Soroban contracts online and view logs/WASM outputs.
- **Deploy to Testnet**: Deploy your contracts instantly to the Stellar Testnet.
- **Contract Interaction**: Read and write functions easily via an auto-generated UI.
- **Storage Viewer**: Explore contract storage keys and values.
- **Yield Optimizer MVP**: Cross-protocol strategy simulation with deposits, withdrawals, auto-compounding, and deterministic backtesting.
- **Patent Registry MVP**: Decentralized patent registration, verification, and licensing marketplace with smart contract validation.

## Project Structure
This repository uses a monorepo setup:
- `frontend/`: The Next.js React application containing the UI.
- `backend/`: The Node.js Express application responsible for Soroban CLI interactions.

## Getting Started

### Prerequisites
- Node.js (v18+)
- NPM or Yarn
- Rust (for the backend compilation engine)
- Soroban CLI

### Local Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/soroban-playground.git
   ```
2. Install dependencies for all workspaces:
   ```bash
   npm install
   ```
3. Start the application stack (Frontend and Backend concurrently):
   ```bash
   npm run dev
   ```

## Contributing
We welcome contributions! Please see our [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on how to get started.

## Yield Optimizer (Issue #316)

This repository includes a smallest-complete implementation across contract, backend, and frontend:

- Soroban contract example: `contracts/yield-optimizer`
- Backend APIs: `backend/src/routes/optimizer.js`
- Frontend dashboard: `frontend/src/app/yield-optimizer/page.tsx`

## Patent Registry (Issue #350)

Decentralized patent registry with invention verification and licensing marketplace:

- Soroban contract example: `contracts/patent-registry`
- Backend APIs: `backend/src/routes/patentRegistry.js`
- Backend service: `backend/src/services/patentRegistryService.js`
- Frontend service: `frontend/src/services/patentRegistryService.ts`
- Frontend dashboard: `frontend/src/app/patent-registry/page.tsx`

Features:
- Register patents with metadata URIs and hashes
- Verify patents through designated verifiers
- Create and manage license offers
- Accept licenses with payment references
- View all patents, verified inventions, and active license offers

### Contract Summary

`contracts/yield-optimizer` supports:

- strategy create/update/list
- user deposit and withdraw
- share and balance tracking per user position
- executor/admin-only compound flow
- emergency pause/unpause
- events on strategy create/update, deposit, withdraw, and compound

### Backend API Examples

Base URL: `http://localhost:5000/api/optimizer`

Create strategy:

```bash
curl -X POST http://localhost:5000/api/optimizer/strategies \
   -H "Content-Type: application/json" \
   -H "x-actor-address: GOPTIMIZERADMIN000000000000000000000000000000000000" \
   -d '{
      "name":"Cross-Protocol Stable Vault",
      "protocol":"Blend + Aquarius",
      "apyBps":1200,
      "feeBps":250,
      "compoundInterval":86400
   }'
```

Deposit:

```bash
curl -X POST http://localhost:5000/api/optimizer/strategies/1/deposit \
   -H "Content-Type: application/json" \
   -H "x-actor-address: GUSERADDRESS" \
   -d '{"amount":5000}'
```

Run deterministic backtest:

```bash
curl -X POST http://localhost:5000/api/optimizer/backtest \
   -H "Content-Type: application/json" \
   -d '{
      "depositAmount":10000,
      "days":30,
      "apyBps":1200,
      "feeBps":250,
      "compoundEveryDays":7
   }'
```

### Backtesting Assumptions

- deterministic mocked return series (no external market fetch)
- strategy protocol text is used as metadata only
- fees are applied on compound checkpoints
- output includes projected yield, APY, drawdown, fees, and daily equity series

### Deployment/Configuration

Optional backend environment variables:

- `OPTIMIZER_ADMIN_ADDRESS`
- `OPTIMIZER_EXECUTOR_ADDRESS`

Frontend API override:

- `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:5000/api`)

## License
MIT License.
