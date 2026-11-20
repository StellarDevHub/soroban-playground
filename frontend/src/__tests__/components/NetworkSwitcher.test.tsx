import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import NetworkSwitcher, {
  NETWORKS,
  CONTRACT_REGISTERS_KEY_PREFIX,
  ACTIVE_CONTRACT_KEY,
} from "../../components/NetworkSwitcher";

let mockTime = 0;

beforeAll(() => {
  jest.spyOn(performance, "now").mockImplementation(() => {
    mockTime += 100;
    return mockTime;
  });
});

beforeEach(() => {
  mockTime = 0;
});

afterAll(() => {
  jest.restoreAllMocks();
});

const renderNetworkSwitcher = async (
  props: React.ComponentProps<typeof NetworkSwitcher> = {},
) => {
  let view: ReturnType<typeof render>;
  await act(async () => {
    view = render(<NetworkSwitcher {...props} />);
  });
  return view!;
};

describe("NetworkSwitcher", () => {
  beforeEach(() => {
    // Reset fetch mock before each test
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: { status: "healthy" } }),
      }),
    ) as jest.Mock;

    // Clear local storage
    localStorage.clear();
  });

  it("renders default network and ping endpoints on mount", async () => {
    await renderNetworkSwitcher();

    // Check if default network (Testnet) is rendered
    expect(screen.getByText("Testnet")).toBeInTheDocument();

    // Check if all networks are pinged (Checking... state first)
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(Object.keys(NETWORKS).length);
    });

    // Check if latency is rendered
    const msTexts = await screen.findAllByText(/\d+ms/);
    expect(msTexts.length).toBeGreaterThan(0);
  });

  it("displays Timeout when fetch aborts", async () => {
    // Mock fetch to simulate AbortError (Timeout)
    const abortError = new Error("The user aborted a request.");
    abortError.name = "AbortError";
    global.fetch = jest.fn(() => Promise.reject(abortError)) as jest.Mock;

    await renderNetworkSwitcher();

    // Open dropdown
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select Network" }));
    });

    await waitFor(() => {
      const offlineTexts = screen.getAllByText("Offline");
      expect(offlineTexts.length).toBeGreaterThan(0);
      const timeoutTexts = screen.getAllByText("Timeout");
      expect(timeoutTexts.length).toBeGreaterThan(0);
    });
  });

  it("displays HTTP status when response is not ok", async () => {
    // Mock fetch to simulate HTTP 503 error
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 503,
      }),
    ) as jest.Mock;

    await renderNetworkSwitcher();

    // Open dropdown
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select Network" }));
    });

    await waitFor(() => {
      const offlineTexts = screen.getAllByText("Offline");
      expect(offlineTexts.length).toBeGreaterThan(0);
      const httpTexts = screen.getAllByText("HTTP 503");
      expect(httpTexts.length).toBeGreaterThan(0);
    });
  });

  it("displays Unhealthy response when status is not healthy", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: null }),
      }),
    ) as jest.Mock;

    await renderNetworkSwitcher();

    // Open dropdown
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select Network" }));
    });

    await waitFor(() => {
      const offlineTexts = screen.getAllByText("Offline");
      expect(offlineTexts.length).toBeGreaterThan(0);
      const errorTexts = screen.getAllByText("Unhealthy response");
      expect(errorTexts.length).toBeGreaterThan(0);
    });
  });

  it("displays generic Network Error on throw", async () => {
    global.fetch = jest.fn(() =>
      Promise.reject(new Error("Failed to fetch")),
    ) as jest.Mock;

    await renderNetworkSwitcher();

    // Open dropdown
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select Network" }));
    });

    await waitFor(() => {
      const offlineTexts = screen.getAllByText("Offline");
      expect(offlineTexts.length).toBeGreaterThan(0);
      const errTexts = screen.getAllByText("Failed to fetch");
      expect(errTexts.length).toBeGreaterThan(0);
    });
  });

  it("can switch networks and clear/reload deployed contract address registers", async () => {
    // Setup existing active contract and registers for futurenet
    localStorage.setItem(
      ACTIVE_CONTRACT_KEY,
      "CTESTNETCONTRACT000000000000000000000000000000000000000000",
    );
    const futurenetContracts = [
      "CFUTURENET11111111111111111111111111111111111111111111111111",
      "CFUTURENET22222222222222222222222222222222222222222222222222",
    ];
    localStorage.setItem(
      `${CONTRACT_REGISTERS_KEY_PREFIX}futurenet`,
      JSON.stringify(futurenetContracts),
    );

    const invalidationSpy = jest.fn();
    window.addEventListener(
      "soroban-contract-cache-invalidation",
      invalidationSpy,
    );

    await renderNetworkSwitcher();

    // Open dropdown
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select Network" }));
    });

    // Switch to Futurenet wrapped in act
    await act(async () => {
      fireEvent.click(screen.getByText("Futurenet"));
    });

    // Check if Futurenet is stored in localStorage
    await waitFor(() => {
      expect(localStorage.getItem("soroban_playground_network")).toBe(
        "futurenet",
      );
    });

    // Active contract address from old network must be invalidated/cleared
    expect(localStorage.getItem(ACTIVE_CONTRACT_KEY)).toBeNull();

    // Event must be dispatched with reloaded contracts for futurenet
    expect(invalidationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          network: "futurenet",
          reloadedContracts: futurenetContracts,
        }),
      }),
    );

    window.removeEventListener(
      "soroban-contract-cache-invalidation",
      invalidationSpy,
    );
  });

  it("warns developers if connected wallet network diverges from playground network", async () => {
    await renderNetworkSwitcher({
      isWalletConnected: true,
      walletNetwork: "mainnet",
    });

    // Playground defaults to Testnet, while wallet is on Mainnet
    expect(
      screen.getByTestId("network-mismatch-warning"),
    ).toBeInTheDocument();

    // Open dropdown to view warning details
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select Network" }));
    });

    expect(
      screen.getByTestId("wallet-network-mismatch-banner"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Wallet Network Mismatch"),
    ).toBeInTheDocument();

    const switchBtn = screen.getByRole("button", {
      name: "Switch Playground to Mainnet",
    });
    expect(switchBtn).toBeInTheDocument();

    // Click switch to align playground network with wallet
    await act(async () => {
      fireEvent.click(switchBtn);
    });

    // Playground network is now aligned with Mainnet; mismatch warning clears
    await waitFor(() => {
      expect(localStorage.getItem("soroban_playground_network")).toBe(
        "mainnet",
      );
      expect(
        screen.queryByTestId("network-mismatch-warning"),
      ).not.toBeInTheDocument();
    });
  });

  it("does not show mismatch warning when wallet network matches playground network", async () => {
    await renderNetworkSwitcher({
      isWalletConnected: true,
      walletNetwork: "testnet",
    });

    expect(
      screen.queryByTestId("network-mismatch-warning"),
    ).not.toBeInTheDocument();

    // Open dropdown
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select Network" }));
    });
    expect(
      screen.queryByTestId("wallet-network-mismatch-banner"),
    ).not.toBeInTheDocument();
  });

  it("pings active RPC endpoints every 15 seconds", async () => {
    jest.useFakeTimers();

    await renderNetworkSwitcher();

    // Initial ping on mount
    expect(global.fetch).toHaveBeenCalledTimes(Object.keys(NETWORKS).length);

    // Advance 15 seconds
    await act(async () => {
      jest.advanceTimersByTime(15000);
    });

    expect(global.fetch).toHaveBeenCalledTimes(
      Object.keys(NETWORKS).length * 2,
    );

    // Advance another 15 seconds
    await act(async () => {
      jest.advanceTimersByTime(15000);
    });

    expect(global.fetch).toHaveBeenCalledTimes(
      Object.keys(NETWORKS).length * 3,
    );

    jest.useRealTimers();
  });

  it("supports manual ping refresh button", async () => {
    await renderNetworkSwitcher();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(Object.keys(NETWORKS).length);
    });

    // Open dropdown
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select Network" }));
    });

    // Click refresh button
    const refreshBtn = screen.getByRole("button", {
      name: "Ping RPC Endpoints",
    });

    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(
        Object.keys(NETWORKS).length * 2,
      );
    });
  });
});
