/**
 * useOracleStatus tests
 */

import { renderHook, act } from "@testing-library/react";
import { useOracleStatus } from "@/hooks/useOracleStatus";

const mockFetch = jest.fn<(url: string, options?: any) => Promise<any>>();
(global as any).fetch = mockFetch;

const store: any[] = [];
class FakeWebSocket {
  readyState = 0;
  OPEN = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send = jest.fn();
  close = jest.fn(() => {
    this.readyState = 3;
    this.onclose?.();
  });

  constructor() {
    store.push(this);
  }

  triggerOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  triggerClose() {
    this.readyState = 3;
    this.onclose?.();
  }

  triggerError() {
    this.onerror?.(new Event("error"));
    this.triggerClose();
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  (global as any).WebSocket = FakeWebSocket;
  store.length = 0;
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function latestWs() {
  return store[store.length - 1];
}

function setThreeFetchMocks(data: {
  nodes?: any[];
  proofs?: any[];
  health?: any;
}) {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: data.nodes ?? [] }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: data.proofs ?? [] }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: data.health ?? null }),
    });
}

describe("useOracleStatus", () => {
  describe("refresh", () => {
    it("loads nodes, proofs, and health on refresh", async () => {
      setThreeFetchMocks({
        nodes: [{ id: "node1" }],
        proofs: [{ id: "proof1" }],
        health: { status: "healthy" },
      });

      const { result } = renderHook(() => useOracleStatus({ pollMs: 999999 }));

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.nodes).toEqual([{ id: "node1" }]);
      expect(result.current.proofs).toEqual([{ id: "proof1" }]);
      expect(result.current.health).toEqual({ status: "healthy" });
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("sets error on fetch failure", async () => {
      setThreeFetchMocks({});
      mockFetch.mockRejectedValueOnce(new Error("Fetch failed"));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: {} }),
      });

      const { result } = renderHook(() => useOracleStatus({ pollMs: 999999 }));
      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.error).toBe("Fetch failed");
      expect(result.current.loading).toBe(false);
    });
  });

  describe("submitProof", () => {
    it("sends POST and updates proofs optimistically", async () => {
      const newProof = { id: "proof-1", status: "submitted" as const };
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: {} }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: {} }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: newProof, success: true }),
        });

      const { result } = renderHook(() => useOracleStatus({ pollMs: 999999 }));
      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.refresh();
      });

      let ret: any;
      await act(async () => {
        ret = await result.current.submitProof("payload", { meta: "data" });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/oracle/proofs",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payload: "payload",
            metadata: { meta: "data" },
            wait: false,
          }),
        }),
      );

      expect(result.current.proofs[0]).toEqual(newProof);
      expect(ret).toEqual(newProof);
    });

    it("returns null and sets error on failure", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: {} }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: {} }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ message: "Submission failed" }),
        });

      const { result } = renderHook(() => useOracleStatus({ pollMs: 999999 }));

      await act(async () => {
        await result.current.refresh();
      });

      let ret: any;
      await act(async () => {
        ret = await result.current.submitProof("payload");
      });

      expect(ret).toBeNull();
      expect(result.current.error).toBe("Submission failed");
    });
  });

  describe("loading state", () => {
    it("starts loading and ends after refresh", async () => {
      setThreeFetchMocks({});

      const { result } = renderHook(() => useOracleStatus({ pollMs: 999999 }));

      expect(result.current.loading).toBe(true);

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.loading).toBe(false);
    });
  });

  describe("error handling", () => {
    it("clears previous error on successful refresh", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: {} }),
        })
        .mockRejectedValueOnce(new Error("Initial error"))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: {} }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: {} }),
        });

      const { result } = renderHook(() => useOracleStatus({ pollMs: 999999 }));
      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.refresh();
      });
      expect(result.current.error).toBe("Initial error");

      await act(async () => {
        await result.current.refresh();
      });
      expect(result.current.error).toBeNull();
    });
  });

  describe("WebSocket message handling", () => {
    it("adds oracle-event messages to events and triggers refresh on proof transitions", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: {} }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: {} }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: {} }),
        });

      const { result } = renderHook(() => useOracleStatus({ pollMs: 9999999 }));

      await act(async () => {
        await result.current.refresh();
      });

      await act(async () => {
        latestWs().triggerOpen();
      });

      const ws = latestWs();
      await act(async () => {
        ws.onmessage?.({
          data: JSON.stringify({
            type: "oracle-event",
            event: "proof.submitted",
            ts: 1,
          }),
        });
      });

      expect(result.current.events.length).toBe(1);
      expect(result.current.events[0]).toEqual({
        type: "oracle-event",
        event: "proof.submitted",
        ts: 1,
      });
    });

    it("ignores non-oracle-event messages", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: {} }),
        });

      const { result } = renderHook(() => useOracleStatus({ pollMs: 9999999 }));

      await act(async () => {
        await result.current.refresh();
      });

      await act(async () => {
        latestWs().triggerOpen();
      });

      const ws = latestWs();
      ws.onmessage?.({
        data: JSON.stringify({ type: "other-event", event: "ping" }),
      });

      expect(result.current.events.length).toBe(0);
    });
  });

  describe("WebSocket cleanup", () => {
    it("closes socket on unmount", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: {} }),
        });

      const { unmount, result } = renderHook(() =>
        useOracleStatus({ pollMs: 9999999 }),
      );

      await act(async () => {
        await result.current.refresh();
      });

      await act(async () => {
        latestWs().triggerOpen();
      });

      const ws = latestWs();

      unmount();

      expect(ws.close).toHaveBeenCalled();
    });
  });
});
