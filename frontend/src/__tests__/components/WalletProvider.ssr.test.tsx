/**
 * #1369 — SSR-safe wallet initialization.
 *
 * Direct access to `window` / `localStorage` during the server render causes
 * React hydration errors. The wallet provider must render a static
 * disconnected state on the server and adopt the persisted session only in a
 * mount effect. These tests pin that contract.
 */

import React from "react";
import { render, screen, act } from "@testing-library/react";
import { WalletProvider, useWallet } from "@/components/providers/WalletProvider";

function WalletProbe() {
  const { activeWallet, activeAccount, status } = useWallet();
  return (
    <div>
      <span data-testid="wallet">{activeWallet ?? "none"}</span>
      <span data-testid="account">{activeAccount ?? "none"}</span>
      <span data-testid="status">{status}</span>
    </div>
  );
}

const VALID_ADDRESS = "GB3KJPLFUYN5VL6R3GU3EGCGVCJAFDSDVBBER5SNLZHTMFK3STCQHI4X";

// #2035 — a restored session is confirmed with the wallet before it is
// trusted, so the wallet kit reports the stored account here.
jest.mock("@creit.tech/stellar-wallets-kit/sdk", () => ({
  StellarWalletsKit: {
    init: jest.fn(),
    setWallet: jest.fn(),
    refreshSupportedWallets: jest.fn().mockResolvedValue([]),
    getAddress: jest.fn().mockResolvedValue({
      address: "GB3KJPLFUYN5VL6R3GU3EGCGVCJAFDSDVBBER5SNLZHTMFK3STCQHI4X",
    }),
    disconnect: jest.fn().mockResolvedValue(undefined),
  },
}), { virtual: true });
jest.mock("@creit.tech/stellar-wallets-kit/types", () => ({
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
}), { virtual: true });
jest.mock("@creit.tech/stellar-wallets-kit/modules/albedo", () => ({ AlbedoModule: class {} }), { virtual: true });
jest.mock("@creit.tech/stellar-wallets-kit/modules/freighter", () => ({ FreighterModule: class {} }), { virtual: true });
jest.mock("@creit.tech/stellar-wallets-kit/modules/hana", () => ({ HanaModule: class {} }), { virtual: true });
jest.mock("@creit.tech/stellar-wallets-kit/modules/xbull", () => ({ xBullModule: class {} }), { virtual: true });
jest.mock("@creit.tech/stellar-wallets-kit/modules/ledger", () => ({ LedgerModule: class {} }), { virtual: true });
jest.mock("@ledgerhq/hw-transport-webhid", () => ({
  default: { isSupported: jest.fn().mockResolvedValue(false) },
}), { virtual: true });
jest.mock("@ledgerhq/hw-transport-webusb", () => ({
  default: { isSupported: jest.fn().mockResolvedValue(false) },
}), { virtual: true });
jest.mock("buffer", () => ({ Buffer: class MockBuffer {} }), { virtual: true });

function persistSession() {
  window.localStorage.setItem(
    "stellar_wallet_session",
    JSON.stringify({
      version: 1,
      wallet: "freighter",
      address: VALID_ADDRESS,
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
      lastActivityAt: Date.now(),
      signerKeys: [],
    }),
  );
}

describe("WalletProvider SSR hydration safety (#1369)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    window.localStorage.clear();
    (console.error as jest.Mock).mockRestore?.();
  });

  it("renders a static disconnected state on the server even with a session", () => {
    persistSession();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { renderToString } = require("react-dom/server");
    const html = renderToString(
      <WalletProvider>
        <WalletProbe />
      </WalletProvider>,
    );

    expect(html).toContain('data-testid="wallet">none<');
    expect(html).toContain('data-testid="status">idle<');
  });

  it("does not throw when `window` is absent", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { renderToString } = require("react-dom/server");
    expect(() =>
      renderToString(
        <WalletProvider>
          <WalletProbe />
        </WalletProvider>,
      ),
    ).not.toThrow();
  });

  it("adopts the persisted session only after mount", async () => {
    persistSession();

    render(
      <WalletProvider>
        <WalletProbe />
      </WalletProvider>,
    );

    await act(async () => {
      // Let the restore-session + discovery effects settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The session restore runs in an effect, so the mounted tree converges
    // on the stored account instead of staying disconnected.
    expect(screen.getByTestId("account")).toHaveTextContent(VALID_ADDRESS);
  });
});
