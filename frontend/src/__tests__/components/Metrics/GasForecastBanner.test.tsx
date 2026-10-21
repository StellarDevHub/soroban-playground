import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import GasForecastBanner, {
  stroopsToXlm,
  xlmToStroops,
  calculateMovingAverageAndStdDev,
  determineCongestionLevel,
  calculateFeePresets,
  getHorizonFeeStatsUrl,
  getFeePollingIntervalMs,
  DEFAULT_BASE_FEE,
  STROOPS_PER_XLM,
} from "../../../components/Metrics/GasForecastBanner";

beforeEach(() => {
  jest.spyOn(global, "fetch").mockImplementation(() => new Promise<Response>(() => {}));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GasForecastBanner - Statistical & Conversion Engine", () => {
  it("resolves network-specific and custom Horizon fee endpoints", () => {
    expect(getHorizonFeeStatsUrl("mainnet")).toBe("https://horizon.stellar.org/fee_stats");
    expect(getHorizonFeeStatsUrl("testnet")).toBe("https://horizon-testnet.stellar.org/fee_stats");
    expect(getHorizonFeeStatsUrl("futurenet")).toBe("https://horizon-futurenet.stellar.org/fee_stats");
    expect(getHorizonFeeStatsUrl("local")).toBe("http://localhost:8000/fee_stats");
    expect(getHorizonFeeStatsUrl("local", "http://localhost:9000")).toBe("http://localhost:9000/fee_stats");
    expect(getHorizonFeeStatsUrl("local", "http://localhost:9000/fee_stats")).toBe("http://localhost:9000/fee_stats");
    expect(getFeePollingIntervalMs(true, 5000)).toBe(5000);
    expect(getFeePollingIntervalMs(false, 5000)).toBe(30_000);
    expect(getFeePollingIntervalMs(false, 45_000)).toBe(45_000);
  });

  describe("stroopsToXlm & xlmToStroops", () => {
    it("converts Stroops to human-readable XLM representations", () => {
      expect(stroopsToXlm(10_000_000)).toBe("1.0000 XLM");
      expect(stroopsToXlm(100)).toBe("0.00001 XLM");
      expect(stroopsToXlm(0)).toBe("0 XLM");
      expect(stroopsToXlm(-50)).toBe("0 XLM");
    });

    it("converts XLM to integer Stroops correctly", () => {
      expect(xlmToStroops(1.0)).toBe(10_000_000);
      expect(xlmToStroops(0.00001)).toBe(100);
      expect(xlmToStroops(0)).toBe(0);
      expect(xlmToStroops(-1)).toBe(0);
    });
  });

  describe("calculateMovingAverageAndStdDev", () => {
    it("calculates exact mean and standard deviation for uniform samples", () => {
      const samples = [100, 100, 100, 100];
      const res = calculateMovingAverageAndStdDev(samples);
      expect(res.mean).toBe(100);
      expect(res.stdDev).toBe(0);
      expect(res.min).toBe(100);
      expect(res.max).toBe(100);
    });

    it("calculates accurate statistics for distributed fee samples", () => {
      // Samples: [100, 200, 300, 400]
      // Mean = 1000 / 4 = 250
      // Variance = ((100-250)^2 + (200-250)^2 + (300-250)^2 + (400-250)^2) / 4
      //          = (22500 + 2500 + 2500 + 22500) / 4 = 50000 / 4 = 12500
      // StdDev = sqrt(12500) ≈ 111.803
      const samples = [100, 200, 300, 400];
      const res = calculateMovingAverageAndStdDev(samples);
      expect(res.mean).toBe(250);
      expect(res.min).toBe(100);
      expect(res.max).toBe(400);
      expect(Math.round(res.stdDev)).toBe(112);
    });

    it("handles empty samples array gracefully", () => {
      const res = calculateMovingAverageAndStdDev([]);
      expect(res.mean).toBe(DEFAULT_BASE_FEE);
      expect(res.stdDev).toBe(0);
    });
  });

  describe("determineCongestionLevel", () => {
    it("classifies low capacity usage as 'low' congestion", () => {
      const res = determineCongestionLevel(0.35, 100, 150, 20, 110);
      expect(res.congestion).toBe("low");
      expect(res.surgeProbability).toBeLessThan(35);
    });

    it("classifies intermediate capacity as 'moderate' load", () => {
      const res = determineCongestionLevel(0.65, 120, 160, 25, 130);
      expect(res.congestion).toBe("moderate");
      expect(res.surgeProbability).toBeGreaterThanOrEqual(25);
    });

    it("classifies high capacity usage (>= 85%) as 'surge' pricing", () => {
      const res = determineCongestionLevel(0.92, 1000, 4000, 1200, 1500);
      expect(res.congestion).toBe("surge");
      expect(res.surgeProbability).toBeGreaterThanOrEqual(75);
    });
  });

  describe("calculateFeePresets", () => {
    it("calculates adaptive slow, average, and fast presets", () => {
      const presets = calculateFeePresets(100, 150, 40, 100, 180, 300, "low");

      expect(presets.slow.stroops).toBeGreaterThanOrEqual(100);
      expect(presets.average.stroops).toBeGreaterThan(presets.slow.stroops);
      expect(presets.fast.stroops).toBeGreaterThan(presets.average.stroops);

      expect(presets.fast.inclusionProbability).toBe(99);
      expect(presets.average.inclusionProbability).toBeGreaterThan(presets.slow.inclusionProbability);
    });

    it("scales fast priority fee aggressively during network surges", () => {
      const surgePresets = calculateFeePresets(100, 1500, 800, 800, 1800, 4000, "surge");
      expect(surgePresets.fast.stroops).toBeGreaterThanOrEqual(300); // at least 3x base fee
      expect(surgePresets.slow.estimatedLatency).toContain("several ledgers");
    });
  });
});

describe("GasForecastBanner UI Component", () => {
  it("renders status pill, capacity meter, and ledger height in compact mode", () => {
    render(<GasForecastBanner networkId="testnet" compact={true} />);

    expect(screen.getByTestId("gas-forecast-banner")).toBeInTheDocument();
    expect(screen.getByTestId("congestion-status-pill")).toBeInTheDocument();
    expect(screen.getByTestId("capacity-progress-bar")).toBeInTheDocument();
    expect(screen.getByText(/Ledger #/i)).toBeInTheDocument();
  });

  it("toggles expanded drawer when clicking Details / Hide button", () => {
    render(<GasForecastBanner networkId="testnet" compact={true} />);

    const toggleBtn = screen.getByRole("button", { name: /Expand fee drawer/i });
    fireEvent.click(toggleBtn);

    // Preset cards should now be visible
    expect(screen.getByTestId("preset-card-slow")).toBeInTheDocument();
    expect(screen.getByTestId("preset-card-average")).toBeInTheDocument();
    expect(screen.getByTestId("preset-card-fast")).toBeInTheDocument();
    expect(screen.getByTestId("preset-card-custom")).toBeInTheDocument();

    // Click again to collapse
    const collapseBtn = screen.getByRole("button", { name: /Collapse fee drawer/i });
    fireEvent.click(collapseBtn);
    expect(screen.queryByTestId("preset-card-slow")).not.toBeInTheDocument();
  });

  it("calls onSelectFee callback when selecting a preset", () => {
    const handleSelectFee = jest.fn();
    render(
      <GasForecastBanner
        networkId="testnet"
        compact={false}
        onSelectFee={handleSelectFee}
      />
    );

    const fastCard = screen.getByTestId("preset-card-fast");
    fireEvent.click(fastCard);

    expect(handleSelectFee).toHaveBeenCalledWith(expect.any(Number), "fast");
  });

  it("allows entering custom Stroop amounts", () => {
    const handleSelectFee = jest.fn();
    render(
      <GasForecastBanner
        networkId="testnet"
        compact={false}
        onSelectFee={handleSelectFee}
      />
    );

    const customInput = screen.getByTestId("custom-stroops-input");
    fireEvent.change(customInput, { target: { value: "750" } });
    fireEvent.blur(customInput);

    expect(handleSelectFee).toHaveBeenCalledWith(750, "custom");
  });

  it("reflects selectedStroops as the custom fee value", () => {
    render(<GasForecastBanner selectedStroops={750} />);
    expect(screen.getByTestId("custom-stroops-input")).toHaveValue(750);
  });

  it("uses rpcUrl for the latest ledger and marks successful Horizon data live", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "https://rpc.example") {
        expect(init?.method).toBe("POST");
        return { ok: true, json: async () => ({ result: { sequence: 12345 } }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          last_ledger_base_fee: "100",
          ledger_capacity_usage: "0.4",
          last_ledger: "12344",
          fee_charged: { p20: "100", p50: "110", p60: "120", p90: "180", p95: "220", p99: "300" },
        }),
      } as Response;
    });
    render(<GasForecastBanner networkId="testnet" rpcUrl="https://rpc.example" compact />);
    expect(await screen.findByText("Ledger #12,345")).toBeInTheDocument();
    expect(screen.getByTestId("fee-data-status")).toHaveTextContent("Live Horizon data");
    expect(fetchSpy).toHaveBeenCalledWith("https://rpc.example", expect.objectContaining({ method: "POST" }));
  });

  it("keeps the last successful ledger and marks data stale after a refresh failure", async () => {
    const liveResponse = {
      ok: true,
      json: async () => ({
        last_ledger_base_fee: "100",
        ledger_capacity_usage: "0.4",
        last_ledger: "54321",
        fee_charged: { p20: "100", p50: "110", p60: "120", p90: "180", p95: "220", p99: "300" },
      }),
    } as Response;
    const fetchSpy = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(liveResponse)
      .mockRejectedValueOnce(new Error("offline"));
    render(<GasForecastBanner compact />);
    expect(await screen.findByText("Ledger #54,321")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh fee stats" }));
    expect(await screen.findByText(/Showing the last successful reading/i)).toBeInTheDocument();
    expect(screen.getByTestId("fee-data-status")).toHaveTextContent("Stale network data");
    expect(screen.getByText("Ledger #54,321")).toBeInTheDocument();
  });

  it("labels initial fallback metrics as demo data", () => {
    render(<GasForecastBanner compact />);
    expect(screen.getByTestId("fee-data-status")).toHaveTextContent("Demo data");
  });

  it("displays high congestion alert callout when simulateSurge is true", () => {
    render(<GasForecastBanner simulateSurge={true} />);

    expect(screen.getByTestId("surge-alert-callout")).toBeInTheDocument();
    expect(screen.getByText(/High Network Congestion Detected/i)).toBeInTheDocument();
    expect(screen.getByText(/Surge Expected/i)).toBeInTheDocument();
  });

  it("handles document visibilitychange event listeners gracefully", () => {
    const addEventListenerSpy = jest.spyOn(document, "addEventListener");
    const removeEventListenerSpy = jest.spyOn(document, "removeEventListener");

    const { unmount } = render(<GasForecastBanner />);
    expect(addEventListenerSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });
});
