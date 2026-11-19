import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  WalletProvider,
  isSessionFresh,
  useWallet,
} from "@/components/providers/WalletProvider";

const mockWalletKit = {
  init: jest.fn(),
  setWallet: jest.fn(),
  refreshSupportedWallets: jest.fn(),
  fetchAddress: jest.fn(),
  getNetwork: jest.fn(),
  signTransaction: jest.fn(),
  disconnect: jest.fn(),
};
const mockFetch = jest.fn();
const mockLedgerModule = {
  productId: "LEDGER",
  disconnect: jest.fn(),
};
const mockWebHidTransport = {
  isSupported: jest.fn(),
  create: jest.fn(),
};
const mockWebUsbTransport = {
  isSupported: jest.fn(),
  create: jest.fn(),
};
const TEST_ADDRESS = `G${"A".repeat(55)}`;
const ROTATED_ADDRESS = `G${"B".repeat(55)}`;

jest.mock("@creit.tech/stellar-wallets-kit/sdk", () => ({
  StellarWalletsKit: mockWalletKit,
}), { virtual: true });

jest.mock("@creit.tech/stellar-wallets-kit/modules/albedo", () => ({
  AlbedoModule: class {
    productId = "albedo";
  },
}), { virtual: true });

jest.mock("@creit.tech/stellar-wallets-kit/modules/freighter", () => ({
  FreighterModule: class {
    productId = "freighter";
  },
}), { virtual: true });

jest.mock("@creit.tech/stellar-wallets-kit/modules/hana", () => ({
  HanaModule: class {
    productId = "hana";
  },
}), { virtual: true });

jest.mock("@creit.tech/stellar-wallets-kit/modules/xbull", () => ({
  xBullModule: class {
    productId = "xbull";
  },
}), { virtual: true });

jest.mock("@creit.tech/stellar-wallets-kit/modules/ledger", () => ({
  LedgerModule: class {
    productId = mockLedgerModule.productId;
    disconnect = mockLedgerModule.disconnect;
  },
}), { virtual: true });

jest.mock("@ledgerhq/hw-transport-webhid", () => ({
  default: mockWebHidTransport,
}), { virtual: true });

jest.mock("@ledgerhq/hw-transport-webusb", () => ({
  default: mockWebUsbTransport,
}), { virtual: true });

jest.mock("@creit.tech/stellar-wallets-kit/types", () => ({
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
}), { virtual: true });

jest.mock("buffer", () => ({
  Buffer: class MockBuffer {},
}), { virtual: true });

function WalletControls() {
  const wallet = useWallet();
  const [signedXdr, setSignedXdr] = React.useState("");

  return (
    <div>
      <output data-testid="status">{wallet.status}</output>
      <output data-testid="connectionState">{wallet.connectionState}</output>
      <output data-testid="address">{wallet.address}</output>
      <output data-testid="error">{wallet.error}</output>
      <output data-testid="reauthentication">
        {String(wallet.reauthenticationRequired)}
      </output>
      <output data-testid="sessionValidation">{wallet.sessionValidation}</output>
      <output>{signedXdr}</output>
      <button onClick={() => void wallet.connect("freighter")}>Connect</button>
      <button onClick={() => void wallet.connect("ledger")}>Connect Ledger</button>
      <button onClick={() => void wallet.connect("albedo")}>Connect Albedo</button>
      <button
        onClick={async () =>
          setSignedXdr((await wallet.signTransaction("unsigned-xdr")) ?? "")
        }
      >
        Sign
      </button>
      <button onClick={() => void wallet.reauthenticate()}>Reauthenticate</button>
    </div>
  );
}

describe("WalletProvider", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockLedgerModule.disconnect.mockResolvedValue(undefined);
    mockWebHidTransport.isSupported.mockResolvedValue(false);
    mockWebUsbTransport.isSupported.mockResolvedValue(true);
    mockWebUsbTransport.create.mockResolvedValue({ close: jest.fn() });
    mockWalletKit.disconnect.mockResolvedValue(undefined);
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        account_id: TEST_ADDRESS,
        signers: [{ key: TEST_ADDRESS, weight: 1 }],
      }),
    });
    mockWalletKit.refreshSupportedWallets.mockResolvedValue([
      { id: "freighter", isAvailable: true },
    ]);
    mockWalletKit.fetchAddress.mockResolvedValue({ address: TEST_ADDRESS });
    mockWalletKit.getNetwork.mockResolvedValue({
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    mockWalletKit.signTransaction.mockResolvedValue({ signedTxXdr: "signed-xdr" });
  });

  it("connects a detected wallet and returns the wallet's signed XDR", async () => {
    render(
      <WalletProvider>
        <WalletControls />
      </WalletProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("connected"),
    );
    expect(screen.getByTestId("address")).toHaveTextContent(TEST_ADDRESS);
    expect(window.localStorage.getItem("preferred_wallet")).toBe("freighter");

    fireEvent.click(screen.getByRole("button", { name: "Sign" }));

    await waitFor(() =>
      expect(mockWalletKit.signTransaction).toHaveBeenCalledWith("unsigned-xdr", {
        networkPassphrase: "Test SDF Network ; September 2015",
        address: TEST_ADDRESS,
      }),
    );
    expect(await screen.findByText("signed-xdr")).toBeInTheDocument();
  });

  it("does not connect an unavailable wallet", async () => {
    render(
      <WalletProvider>
        <WalletControls />
      </WalletProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect Albedo" }));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unavailable"),
    );
    expect(screen.getByTestId("error")).toHaveTextContent(
      "albedo wallet is not available",
    );
    expect(mockWalletKit.fetchAddress).not.toHaveBeenCalled();
  });

  it("restores a recent public session and validates it against Horizon", async () => {
    window.localStorage.setItem(
      "stellar_wallet_session",
      JSON.stringify({
        version: 1,
        wallet: "freighter",
        address: TEST_ADDRESS,
        network: "TESTNET",
        networkPassphrase: "Test SDF Network ; September 2015",
        lastActivityAt: Date.now(),
        signerKeys: [TEST_ADDRESS],
      }),
    );

    render(
      <WalletProvider>
        <WalletControls />
      </WalletProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("connected"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("reauthentication")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("address")).toHaveTextContent(TEST_ADDRESS);
    expect(mockFetch).toHaveBeenCalledWith(
      `https://horizon-testnet.stellar.org/accounts/${TEST_ADDRESS}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mockWalletKit.fetchAddress).not.toHaveBeenCalled();
  });

  it("requires a reconnect after the persisted session exceeds the inactivity limit", async () => {
    window.localStorage.setItem(
      "stellar_wallet_session",
      JSON.stringify({
        version: 1,
        wallet: "freighter",
        address: TEST_ADDRESS,
        network: "TESTNET",
        networkPassphrase: "Test SDF Network ; September 2015",
        lastActivityAt: Date.now() - 31 * 60 * 1000,
        signerKeys: [TEST_ADDRESS],
      }),
    );

    render(
      <WalletProvider>
        <WalletControls />
      </WalletProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("reauthentication")).toHaveTextContent("true"),
    );
    expect(window.localStorage.getItem("stellar_wallet_session")).toBeNull();
    expect(screen.getByTestId("error")).toHaveTextContent("expired after inactivity");
  });

  it("requires re-authentication when the wallet signs with a rotated account", async () => {
    mockWalletKit.signTransaction.mockResolvedValueOnce({
      signedTxXdr: "signed-xdr",
      signerAddress: ROTATED_ADDRESS,
    });

    render(
      <WalletProvider>
        <WalletControls />
      </WalletProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("connected"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));

    await waitFor(() =>
      expect(screen.getByTestId("reauthentication")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
    expect(screen.getByTestId("error")).toHaveTextContent("account changed");
  });

  it("requires re-authentication when Horizon no longer has the account", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    window.localStorage.setItem(
      "stellar_wallet_session",
      JSON.stringify({
        version: 1,
        wallet: "freighter",
        address: TEST_ADDRESS,
        network: "TESTNET",
        networkPassphrase: "Test SDF Network ; September 2015",
        lastActivityAt: Date.now(),
        signerKeys: [TEST_ADDRESS],
      }),
    );
    render(
      <WalletProvider>
        <WalletControls />
      </WalletProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("reauthentication")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("error")).toHaveTextContent("no longer available on Horizon");
  });

  it("requires re-authentication when Horizon reports a rotated signer set", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        account_id: TEST_ADDRESS,
        signers: [{ key: ROTATED_ADDRESS, weight: 1 }],
      }),
    });
    window.localStorage.setItem(
      "stellar_wallet_session",
      JSON.stringify({
        version: 1,
        wallet: "freighter",
        address: TEST_ADDRESS,
        network: "TESTNET",
        networkPassphrase: "Test SDF Network ; September 2015",
        lastActivityAt: Date.now(),
        signerKeys: [TEST_ADDRESS],
      }),
    );

    render(
      <WalletProvider>
        <WalletControls />
      </WalletProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("reauthentication")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("error")).toHaveTextContent("signers changed");
  });

  it("times out Ledger signing and requests a reconnect", async () => {
    mockWalletKit.refreshSupportedWallets.mockResolvedValue([
      { id: "LEDGER", isAvailable: true },
    ]);
    mockWalletKit.signTransaction.mockReturnValue(new Promise(() => {}));

    render(
      <WalletProvider>
        <WalletControls />
      </WalletProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect Ledger" }));
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("connected"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("sessionValidation")).toHaveTextContent("verified"),
    );
    jest.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));

    await React.act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("connectionState")).toHaveTextContent("signing");

    await React.act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(120_001);
      await Promise.resolve();
    });

    expect(screen.getByTestId("status")).toHaveTextContent("idle");
    expect(screen.getByTestId("reauthentication")).toHaveTextContent("true");
    expect(screen.getByTestId("error")).toHaveTextContent("Ledger confirmation timed out");
    expect(mockWalletKit.disconnect).toHaveBeenCalled();
  });

  it("uses the newly selected network when Ledger signs", async () => {
    mockWalletKit.refreshSupportedWallets.mockResolvedValue([
      { id: "LEDGER", isAvailable: true },
    ]);

    render(
      <WalletProvider>
        <WalletControls />
      </WalletProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect Ledger" }));
    await waitFor(() =>
      expect(screen.getByTestId("sessionValidation")).toHaveTextContent("verified"),
    );

    window.localStorage.setItem("soroban_playground_network", "mainnet");
    React.act(() => window.dispatchEvent(new Event("soroban-network-change")));
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));

    await waitFor(() =>
      expect(mockWalletKit.signTransaction).toHaveBeenCalledWith("unsigned-xdr", {
        networkPassphrase: "Public Global Stellar Network ; September 2015",
        address: undefined,
      }),
    );
  });

  it("surfaces a user-rejected connection as ERROR instead of deadlocking", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockWalletKit.fetchAddress.mockRejectedValueOnce(
      new Error("User rejected the request"),
    );

    render(
      <WalletProvider>
        <WalletControls />
      </WalletProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("error"),
    );
    expect(screen.getByTestId("connectionState")).toHaveTextContent("error");
    expect(screen.getByTestId("error")).toHaveTextContent(
      "User rejected the request",
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("connected"),
    );
    errorSpy.mockRestore();
  });

  it("treats a Ledger WebHID user rejection during signing as ERROR", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockWalletKit.refreshSupportedWallets.mockResolvedValue([
      { id: "LEDGER", isAvailable: true },
    ]);
    mockWebHidTransport.isSupported.mockResolvedValue(true);
    mockWebHidTransport.create.mockResolvedValue({ close: jest.fn() });
    mockWalletKit.signTransaction.mockRejectedValueOnce(
      new Error("Ledger device: user rejected the signature"),
    );

    render(
      <WalletProvider>
        <WalletControls />
      </WalletProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect Ledger" }));
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("connected"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("error"),
    );
    expect(screen.getByTestId("connectionState")).toHaveTextContent("error");
    expect(screen.getByTestId("error")).toHaveTextContent(
      "user rejected the signature",
    );
    errorSpy.mockRestore();
  });

  it("does not dispatch state when a connection resolves after unmount", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    let resolveFetch: (value: { address: string }) => void = () => {};
    mockWalletKit.fetchAddress.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { unmount } = render(
      <WalletProvider>
        <WalletControls />
      </WalletProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(mockWalletKit.fetchAddress).toHaveBeenCalled());

    unmount();
    await React.act(async () => {
      resolveFetch({ address: TEST_ADDRESS });
      await Promise.resolve();
      await Promise.resolve();
    });

    const actWarnings = errorSpy.mock.calls
      .flat()
      .filter((message) =>
        String(message).toLowerCase().includes("not wrapped in act"),
      );
    expect(actWarnings).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it("auto-reconnects from a validated session through the CONNECTING state", async () => {
    window.localStorage.setItem(
      "stellar_wallet_session",
      JSON.stringify({
        version: 1,
        wallet: "freighter",
        address: TEST_ADDRESS,
        network: "TESTNET",
        networkPassphrase: "Test SDF Network ; September 2015",
        lastActivityAt: Date.now(),
        signerKeys: [TEST_ADDRESS],
      }),
    );

    render(
      <WalletProvider>
        <WalletControls />
      </WalletProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("connectionState")).toHaveTextContent(
        "connected",
      ),
    );
    expect(screen.getByTestId("status")).toHaveTextContent("connected");
    expect(mockWalletKit.fetchAddress).not.toHaveBeenCalled();
  });
});

describe("isSessionFresh (auto-reconnect cache validation)", () => {
  const now = 1_700_000_000_000;
  const session = {
    version: 1 as const,
    wallet: "freighter" as const,
    address: `G${"A".repeat(55)}`,
    network: "TESTNET",
    networkPassphrase: "Test SDF Network ; September 2015",
    lastActivityAt: now - 60_000,
    signerKeys: [],
  };

  it("accepts a recent session", () => {
    expect(isSessionFresh(session, now)).toBe(true);
  });

  it("rejects an expired session", () => {
    expect(isSessionFresh({ ...session, lastActivityAt: now - 30 * 60 * 1000 }, now)).toBe(false);
  });

  it("rejects a session from the future", () => {
    expect(isSessionFresh({ ...session, lastActivityAt: now + 61_000 }, now)).toBe(false);
  });
});