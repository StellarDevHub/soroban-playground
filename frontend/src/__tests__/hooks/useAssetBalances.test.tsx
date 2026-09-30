import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAssetBalances } from "@/hooks/useAssetBalances";

const TEST_ACCOUNT = `G${"A".repeat(55)}`;
const TEST_ISSUER = `G${"B".repeat(55)}`;
const TEST_CONTRACT = `C${"C".repeat(55)}`;
const mockCloseStream = jest.fn();
const mockAccountCall = jest.fn();
const mockGetContractData = jest.fn();
const mockOrderbookCall = jest.fn();
let mockStreamOptions: { onmessage?: (account: unknown) => void; onerror?: () => void } | null = null;

const mockHorizonServer = {
  accounts: () => ({
    accountId: () => ({
      call: mockAccountCall,
      stream: (options: typeof mockStreamOptions) => {
        mockStreamOptions = options;
        return mockCloseStream;
      },
    }),
  }),
  orderbook: () => ({ call: mockOrderbookCall }),
};

jest.mock("@stellar/stellar-sdk", () => ({
  Address: class {
    value: string;

    constructor(value: string) {
      this.value = value;
    }
    toScVal() {
      return this.value;
    }
  },
  Asset: class {
    code: string;
    issuer: string;

    constructor(code: string, issuer: string) {
      this.code = code;
      this.issuer = issuer;
    }
    static native() {
      return new this("XLM", "");
    }
  },
  Horizon: {
    Server: class {
      constructor() {
        return mockHorizonServer;
      }
    },
  },
  rpc: {
    Durability: { Persistent: "persistent" },
    Server: class {
      getContractData = mockGetContractData;
    },
  },
  scValToNative: (value: unknown) => value,
}), { virtual: true });

const accountSnapshot = {
  balances: [
    { asset_type: "native", balance: "12.5000000" },
    {
      asset_type: "credit_alphanum4",
      asset_code: "USD",
      asset_issuer: TEST_ISSUER,
      balance: "5.2500000",
    },
    {
      asset_type: "liquidity_pool_shares",
      liquidity_pool_id: "pool123",
      balance: "1.0000000",
    },
  ],
};

describe("useAssetBalances", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockStreamOptions = null;
    mockCloseStream.mockReset();
    mockAccountCall.mockResolvedValue(accountSnapshot);
    mockOrderbookCall.mockResolvedValue({
      bids: [{ price: "0.50" }],
      asks: [{ price: "0.60" }],
    });
    mockGetContractData.mockResolvedValue({
      val: {
        contractData: () => ({ val: () => 123456789n }),
      },
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.12 } }),
    });
  });

  it("loads account balances, streams deltas, converts prices, and closes the stream", async () => {
    const { result, unmount } = renderHook(() =>
      useAssetBalances(TEST_ACCOUNT, "Test SDF Network ; September 2015"),
    );

    await waitFor(() => expect(result.current.streamStatus).toBe("live"));
    await waitFor(() => expect(result.current.xlmUsd).toBe(0.12));
    expect(result.current.balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbol: "XLM", amount: "12.5000000" }),
        expect.objectContaining({
          symbol: "USD",
          amount: "5.2500000",
          priceInXlm: 0.55,
        }),
        expect.objectContaining({
          kind: "liquidity_pool",
          symbol: "LP shares",
          amount: "1.0000000",
        }),
      ]),
    );

    act(() => {
      mockStreamOptions?.onmessage?.({
        balances: [{ asset_type: "native", balance: "13.5000000" }],
      });
    });

    await waitFor(() =>
      expect(
        result.current.balances.find((balance) => balance.symbol === "XLM")?.delta,
      ).toBe("up"),
    );
    unmount();
    expect(mockCloseStream).toHaveBeenCalled();
  });

  it("validates, persists, and polls a custom SAC balance", async () => {
    const { result } = renderHook(() =>
      useAssetBalances(TEST_ACCOUNT, "Test SDF Network ; September 2015"),
    );

    await waitFor(() => expect(result.current.streamStatus).toBe("live"));
    const invalidResult = result.current.addSac({
      contractId: "not-a-contract",
      symbol: "BAD",
      name: "Bad token",
      decimals: 7,
    });
    expect(invalidResult).toMatch(/valid Stellar contract ID/i);

    act(() => {
      expect(
        result.current.addSac({
          contractId: TEST_CONTRACT,
          symbol: "SAC",
          name: "Sample token",
          decimals: 7,
          marketAssetCode: "USD",
          marketAssetIssuer: TEST_ISSUER,
        }),
      ).toBeNull();
    });

    await waitFor(() => expect(result.current.trackedSacs).toHaveLength(1));
  act(() => result.current.refresh());
    expect(result.current.sacError).toBeNull();
    await waitFor(() => expect(mockGetContractData).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        result.current.balances.find((balance) => balance.contractId === TEST_CONTRACT)
          ?.amount,
      ).toBe("12.3456789"),
    );
    expect(mockGetContractData).toHaveBeenCalledWith(
      TEST_CONTRACT,
      TEST_ACCOUNT,
      "persistent",
    );
    expect(
      window.localStorage.getItem(
        `stellar_tracked_sac_v1:${TEST_ACCOUNT}:Test%20SDF%20Network%20%3B%20September%202015`,
      ),
    ).toContain(TEST_CONTRACT);

    mockGetContractData.mockRejectedValueOnce(new Error("Soroban RPC timeout"));
    act(() => result.current.refresh());
    await waitFor(() =>
      expect(result.current.sacError).toMatch(/last known values/i),
    );
    expect(
      result.current.balances.find((balance) => balance.contractId === TEST_CONTRACT)
        ?.amount,
    ).toBe("12.3456789");
  });

  it("keeps custom SAC lists isolated when the active account changes", async () => {
    const secondAccount = `G${"D".repeat(55)}`;
    const firstToken = {
      contractId: TEST_CONTRACT,
      symbol: "FIRST",
      name: "First account token",
      decimals: 7,
    };
    const secondToken = {
      contractId: `C${"E".repeat(55)}`,
      symbol: "SECOND",
      name: "Second account token",
      decimals: 7,
    };
    const testnetScope = "Test%20SDF%20Network%20%3B%20September%202015";
    window.localStorage.setItem(
      `stellar_tracked_sac_v1:${TEST_ACCOUNT}:${testnetScope}`,
      JSON.stringify([firstToken]),
    );
    window.localStorage.setItem(
      `stellar_tracked_sac_v1:${secondAccount}:${testnetScope}`,
      JSON.stringify([secondToken]),
    );

    const { result, rerender } = renderHook(
      ({ activeAccount }) =>
        useAssetBalances(activeAccount, "Test SDF Network ; September 2015"),
      { initialProps: { activeAccount: TEST_ACCOUNT as string | null } },
    );

    await waitFor(() =>
      expect(result.current.trackedSacs[0]?.symbol).toBe("FIRST"),
    );
    rerender({ activeAccount: secondAccount });
    await waitFor(() =>
      expect(result.current.trackedSacs[0]?.symbol).toBe("SECOND"),
    );

    expect(
      JSON.parse(
        window.localStorage.getItem(
          `stellar_tracked_sac_v1:${TEST_ACCOUNT}:${testnetScope}`,
        ) ?? "[]",
      ),
    ).toEqual([firstToken]);
    expect(
      JSON.parse(
        window.localStorage.getItem(
          `stellar_tracked_sac_v1:${secondAccount}:${testnetScope}`,
        ) ?? "[]",
      ),
    ).toEqual([secondToken]);
  });
});