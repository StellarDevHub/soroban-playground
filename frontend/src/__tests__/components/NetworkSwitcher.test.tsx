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
  normalizeNetwork,
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

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => {
  jest.restoreAllMocks();
});

const renderNetworkSwitcher = async (
  props: React.ComponentProps<typeof NetworkSwitcher> = {},
) => {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<NetworkSwitcher {...props} />);
  });
  return view;
};

const openDropdown = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Select Network" }));
  });
};

describe("NetworkSwitcher", () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: { status: "healthy" } }),
      }),
    ) as jest.Mock;

    localStorage.clear();
  });

  it("renders default network and ping endpoints on mount", async () => {
    await renderNetworkSwitcher();

    expect(screen.getByText("Testnet")).toBeInTheDocument();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(Object.keys(NETWORKS).length);
    });

    const msTexts = await screen.findAllByText(/\d+ms/);
    expect(msTexts.length).toBeGreaterThan(0);
  });

  it("displays Timeout when fetch aborts", async () => {
    const abortError = new Error("The user aborted a request.");
    abortError.name = "AbortError";
    global.fetch = jest.fn(() => Promise.reject(abortError)) as jest.Mock;

    await renderNetworkSwitcher();
    await openDropdown();

    await waitFor(() => {
      expect(screen.getAllByText("Offline").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Timeout").length).toBeGreaterThan(0);
    });
  });

  it("displays HTTP status when response is not ok", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 503,
      }),
    ) as jest.Mock;

    await renderNetworkSwitcher();
    await openDropdown();

    await waitFor(() => {
      expect(screen.getAllByText("Offline").length).toBeGreaterThan(0);
      expect(screen.getAllByText("HTTP 503").length).toBeGreaterThan(0);
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
    await openDropdown();

    await waitFor(() => {
      expect(screen.getAllByText("Offline").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Unhealthy response").length).toBeGreaterThan(
        0,
      );
    });
  });

  it("displays generic Network Error on throw", async () => {
    global.fetch = jest.fn(() =>
      Promise.reject(new Error("Failed to fetch")),
    ) as jest.Mock;

    await renderNetworkSwitcher();
    await openDropdown();

    await waitFor(() => {
      expect(screen.getAllByText("Offline").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Failed to fetch").length).toBeGreaterThan(0);
    });
  });

  it("clears active contracts and reloads the register when switching networks", async () => {
    localStorage.setItem(
      ACTIVE_CONTRACT_KEY,
      "CTESTNETCONTRACT000000000000000000000000000000000000000000",
    );
    localStorage.setItem("soroban_contract_id", "CSTALECONTRACT");
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
    await openDropdown();
    await act(async () => {
      fireEvent.click(screen.getByText("Futurenet"));
    });

    await waitFor(() => {
      expect(localStorage.getItem("soroban_playground_network")).toBe(
        "futurenet",
      );
    });
    expect(localStorage.getItem(ACTIVE_CONTRACT_KEY)).toBeNull();
    expect(localStorage.getItem("soroban_contract_id")).toBeNull();
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

  it("does not invalidate the contract cache on initial mount", async () => {
    localStorage.setItem(
      ACTIVE_CONTRACT_KEY,
      "CTESTNETCONTRACT000000000000000000000000000000000000000000",
    );
    const invalidationSpy = jest.fn();
    window.addEventListener(
      "soroban-contract-cache-invalidation",
      invalidationSpy,
    );

    await renderNetworkSwitcher();

    expect(localStorage.getItem(ACTIVE_CONTRACT_KEY)).not.toBeNull();
    expect(invalidationSpy).not.toHaveBeenCalled();

    window.removeEventListener(
      "soroban-contract-cache-invalidation",
      invalidationSpy,
    );
  });

  it("warns about a wallet network mismatch and can align the playground", async () => {
    await renderNetworkSwitcher({
      isWalletConnected: true,
      walletNetwork: "mainnet",
    });

    expect(screen.getByTestId("network-mismatch-warning")).toBeInTheDocument();

    await openDropdown();

    expect(
      screen.getByTestId("wallet-network-mismatch-banner"),
    ).toBeInTheDocument();
    expect(screen.getByText("Wallet Network Mismatch")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "Switch Playground to Mainnet",
        }),
      );
    });

    await waitFor(() => {
      expect(localStorage.getItem("soroban_playground_network")).toBe(
        "mainnet",
      );
      expect(
        screen.queryByTestId("network-mismatch-warning"),
      ).not.toBeInTheDocument();
    });
  });

  it("does not warn when the wallet network matches the playground", async () => {
    await renderNetworkSwitcher({
      isWalletConnected: true,
      walletNetwork: "testnet",
    });

    expect(
      screen.queryByTestId("network-mismatch-warning"),
    ).not.toBeInTheDocument();

    await openDropdown();

    expect(
      screen.queryByTestId("wallet-network-mismatch-banner"),
    ).not.toBeInTheDocument();
  });

  it("normalizes wallet names and passphrases", () => {
    expect(normalizeNetwork("PUBLIC")).toBe("mainnet");
    expect(normalizeNetwork("Test SDF Network ; September 2015")).toBe(
      "testnet",
    );
    expect(normalizeNetwork("Test SDF Future Network ; October 2022")).toBe(
      "futurenet",
    );
    expect(normalizeNetwork("Standalone Network ; February 2022")).toBe(
      "local",
    );
    expect(normalizeNetwork(null)).toBeNull();
  });

  it("pings RPC endpoints every 15 seconds", async () => {
    jest.useFakeTimers();
    await renderNetworkSwitcher();

    expect(global.fetch).toHaveBeenCalledTimes(Object.keys(NETWORKS).length);

    await act(async () => {
      jest.advanceTimersByTime(15000);
    });
    expect(global.fetch).toHaveBeenCalledTimes(
      Object.keys(NETWORKS).length * 2,
    );

    await act(async () => {
      jest.advanceTimersByTime(15000);
    });
    expect(global.fetch).toHaveBeenCalledTimes(
      Object.keys(NETWORKS).length * 3,
    );
  });

  it("supports manual ping refresh", async () => {
    await renderNetworkSwitcher();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(Object.keys(NETWORKS).length);
    });

    await openDropdown();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Ping RPC Endpoints" }),
      );
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(
        Object.keys(NETWORKS).length * 2,
      );
    });
  });
});
