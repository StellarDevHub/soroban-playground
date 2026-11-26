import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WalletProvider, useWallet } from "@/components/providers/WalletProvider";

const mockWalletKit = {
  init: jest.fn(),
  setWallet: jest.fn(),
  refreshSupportedWallets: jest.fn(),
  fetchAddress: jest.fn(),
  getAddress: jest.fn(),
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


function Probe() {
  const wallet = useWallet();
  const [result, setResult] = React.useState<string>("");
  return (
    <div>
      <output data-testid="state">{wallet.connectionState}</output>
      <output data-testid="status">{wallet.status}</output>
      <output data-testid="signing">{String(wallet.isSigning)}</output>
      <output data-testid="error">{wallet.error}</output>
      <output data-testid="address">{wallet.address}</output>
      <output data-testid="reauthentication">
        {String(wallet.reauthenticationRequired)}
      </output>
      <output data-testid="result">{result}</output>
      <button onClick={() => void wallet.connect("freighter")}>Connect</button>
      <button onClick={() => void wallet.connect("ledger")}>Connect Ledger</button>
      <button onClick={() => wallet.disconnect()}>Disconnect</button>
      <button
        onClick={async () => {
          const signed = await wallet.signTransaction("unsigned-xdr");
          setResult(signed ?? "null");
        }}
      >
        Sign
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <WalletProvider>
      <Probe />
    </WalletProvider>,
  );
}

function persistSession(wallet: string) {
  window.localStorage.setItem(
    "stellar_wallet_session",
    JSON.stringify({
      version: 1,
      wallet,
      address: TEST_ADDRESS,
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
      lastActivityAt: Date.now(),
      signerKeys: [TEST_ADDRESS],
    }),
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function connectFreighter() {
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("CONNECTED"));
}

async function connectLedger() {
  fireEvent.click(screen.getByRole("button", { name: "Connect Ledger" }));
  await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("CONNECTED"));
}

describe("WalletProvider connection state machine (#2035)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockLedgerModule.disconnect.mockResolvedValue(undefined);
    mockWebHidTransport.isSupported.mockResolvedValue(true);
    mockWebHidTransport.create.mockResolvedValue({ close: jest.fn() });
    mockWebUsbTransport.isSupported.mockResolvedValue(false);
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
      { id: "LEDGER", isAvailable: true },
    ]);
    mockWalletKit.fetchAddress.mockResolvedValue({ address: TEST_ADDRESS });
    mockWalletKit.getAddress.mockResolvedValue({ address: TEST_ADDRESS });
    mockWalletKit.getNetwork.mockResolvedValue({
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    mockWalletKit.signTransaction.mockResolvedValue({ signedTxXdr: "signed-xdr" });
  });

  it("starts DISCONNECTED and moves through CONNECTING to CONNECTED", async () => {
    const address = deferred<{ address: string }>();
    mockWalletKit.fetchAddress.mockReturnValueOnce(address.promise);
    renderProvider();
    expect(screen.getByTestId("state")).toHaveTextContent("DISCONNECTED");

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("CONNECTING"));
    expect(screen.getByTestId("status")).toHaveTextContent("connecting");

    await React.act(async () => address.resolve({ address: TEST_ADDRESS }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("CONNECTED"));
    expect(screen.getByTestId("status")).toHaveTextContent("connected");
  });

  it("is SIGNING while the wallet prompt is open and returns to CONNECTED", async () => {
    const signing = deferred<{ signedTxXdr: string }>();
    mockWalletKit.signTransaction.mockReturnValueOnce(signing.promise);
    renderProvider();
    await connectFreighter();

    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("SIGNING"));
    expect(screen.getByTestId("signing")).toHaveTextContent("true");
    // Existing consumers still see a connected session while signing.
    expect(screen.getByTestId("status")).toHaveTextContent("connected");

    await React.act(async () => signing.resolve({ signedTxXdr: "signed-xdr" }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("signed-xdr"));
    expect(screen.getByTestId("state")).toHaveTextContent("CONNECTED");
    expect(screen.getByTestId("signing")).toHaveTextContent("false");
  });

  it("refuses a second signing request while one is open", async () => {
    mockWalletKit.signTransaction.mockReturnValueOnce(new Promise(() => {}));
    renderProvider();
    await connectFreighter();

    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("SIGNING"));
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));

    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("null"));
    expect(screen.getByTestId("error")).toHaveTextContent(
      "A signing request is already open in your wallet.",
    );
    expect(mockWalletKit.signTransaction).toHaveBeenCalledTimes(1);
  });

  it("moves to ERROR with a clear message when the user rejects the connection", async () => {
    mockWalletKit.fetchAddress.mockRejectedValueOnce({ code: -4, message: "User declined access" });
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("ERROR"));
    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(screen.getByTestId("error")).toHaveTextContent(
      "The connection request was rejected in the wallet.",
    );
  });

  it("keeps the Ledger session when the user rejects the transaction on the device", async () => {
    mockWalletKit.signTransaction.mockRejectedValueOnce(
      Object.assign(new Error("Ledger device: Condition of use not satisfied (denied by the user?) (0x6985)"), {
        statusCode: 0x6985,
      }),
    );
    renderProvider();
    await connectLedger();

    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("null"));

    expect(screen.getByTestId("state")).toHaveTextContent("CONNECTED");
    expect(screen.getByTestId("reauthentication")).toHaveTextContent("false");
    expect(screen.getByTestId("error")).toHaveTextContent(
      "The transaction was rejected in the wallet.",
    );
  });

  it("drops the Ledger WebHID session when the device never confirms", async () => {
    mockWalletKit.signTransaction.mockReturnValue(new Promise(() => {}));
    renderProvider();
    await connectLedger();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    jest.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    await React.act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(120_001);
      await Promise.resolve();
    });

    expect(screen.getByTestId("state")).toHaveTextContent("DISCONNECTED");
    expect(screen.getByTestId("signing")).toHaveTextContent("false");
    expect(screen.getByTestId("reauthentication")).toHaveTextContent("true");
    expect(screen.getByTestId("error")).toHaveTextContent("Ledger confirmation timed out");
    expect(mockWalletKit.disconnect).toHaveBeenCalled();
  });

  it("ignores a wallet that answers after the user disconnected", async () => {
    const address = deferred<{ address: string }>();
    mockWalletKit.fetchAddress.mockReturnValueOnce(address.promise);
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("CONNECTING"));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.getByTestId("state")).toHaveTextContent("DISCONNECTED");

    await React.act(async () => address.resolve({ address: TEST_ADDRESS }));
    expect(screen.getByTestId("state")).toHaveTextContent("DISCONNECTED");
    expect(screen.getByTestId("address")).toBeEmptyDOMElement();
  });

  it("does not update state or log after unmounting mid-connection", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const address = deferred<{ address: string }>();
    mockWalletKit.fetchAddress.mockReturnValueOnce(address.promise);
    const { unmount } = renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(mockWalletKit.fetchAddress).toHaveBeenCalled());
    unmount();

    await React.act(async () => address.reject(new Error("transport closed")));
    expect(errorSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("preferred_wallet")).toBeNull();
    errorSpy.mockRestore();
  });

  it("reconnects a cached session only after the wallet confirms the account", async () => {
    const confirm = deferred<{ address: string }>();
    mockWalletKit.getAddress.mockReturnValueOnce(confirm.promise);
    persistSession("freighter");
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("CONNECTING"));
    await React.act(async () => confirm.resolve({ address: TEST_ADDRESS }));

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("CONNECTED"));
    expect(screen.getByTestId("address")).toHaveTextContent(TEST_ADDRESS);
    expect(mockWalletKit.setWallet).toHaveBeenCalledWith("freighter");
    expect(mockWalletKit.fetchAddress).not.toHaveBeenCalled();
  });

  it("requires a reconnect when the wallet now exposes a different account", async () => {
    mockWalletKit.getAddress.mockResolvedValueOnce({ address: ROTATED_ADDRESS });
    persistSession("freighter");
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("reauthentication")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("state")).toHaveTextContent("DISCONNECTED");
    expect(screen.getByTestId("error")).toHaveTextContent("different account");
    expect(window.localStorage.getItem("stellar_wallet_session")).toBeNull();
  });

  it("requires a reconnect when the cached wallet is locked or unreachable", async () => {
    mockWalletKit.getAddress.mockRejectedValueOnce(new Error("Wallet is locked"));
    persistSession("freighter");
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("reauthentication")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("state")).toHaveTextContent("DISCONNECTED");
    expect(screen.getByTestId("error")).toHaveTextContent("could not be reached");
  });

  it("restores a cached Ledger session without prompting the device", async () => {
    persistSession("ledger");
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("CONNECTED"));
    expect(mockWalletKit.getAddress).not.toHaveBeenCalled();
    expect(mockWebHidTransport.create).not.toHaveBeenCalled();
  });
});
