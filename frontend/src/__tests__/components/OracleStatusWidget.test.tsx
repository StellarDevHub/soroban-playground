import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  OracleStatusWidget,
  OracleHealthPill,
} from "@/components/OracleStatusWidget";
import {
  getOracleHealthStatus,
  calculatePriceDeviation,
  OracleFeedData,
} from "@/hooks/useOracleStatus";

describe("Oracle Health & Price Deviation Utilities", () => {
  const baseTime = 1700000000000;

  it("calculates oracle health status correctly based on elapsed seconds", () => {
    // < 60s -> active
    expect(getOracleHealthStatus(baseTime - 30 * 1000, baseTime)).toBe("active");
    expect(getOracleHealthStatus(baseTime - 59 * 1000, baseTime)).toBe("active");

    // 60s - 300s -> delayed
    expect(getOracleHealthStatus(baseTime - 60 * 1000, baseTime)).toBe("delayed");
    expect(getOracleHealthStatus(baseTime - 180 * 1000, baseTime)).toBe("delayed");
    expect(getOracleHealthStatus(baseTime - 300 * 1000, baseTime)).toBe("delayed");

    // > 300s and <= 1800s -> stale
    expect(getOracleHealthStatus(baseTime - 301 * 1000, baseTime)).toBe("stale");
    expect(getOracleHealthStatus(baseTime - 600 * 1000, baseTime)).toBe("stale");
    expect(getOracleHealthStatus(baseTime - 1800 * 1000, baseTime)).toBe("stale");

    // > 1800s -> down
    expect(getOracleHealthStatus(baseTime - 1801 * 1000, baseTime)).toBe("down");
    expect(getOracleHealthStatus(baseTime - 3600 * 1000, baseTime)).toBe("down");

    // Null or undefined timestamp
    expect(getOracleHealthStatus(null, baseTime)).toBe("down");
    expect(getOracleHealthStatus(undefined, baseTime)).toBe("down");
  });

  it("calculates price deviation and basis points accurately", () => {
    // Oracle 101, Spot 100 -> +1.0%, +100 bps
    const dev1 = calculatePriceDeviation(101, 100);
    expect(dev1.deviationPct).toBe(1.0);
    expect(dev1.deviationBps).toBe(100);
    expect(dev1.isDeviated).toBe(true);

    // Oracle 99.5, Spot 100 -> -0.5%, -50 bps
    const dev2 = calculatePriceDeviation(99.5, 100);
    expect(dev2.deviationPct).toBe(-0.5);
    expect(dev2.deviationBps).toBe(-50);
    expect(dev2.isDeviated).toBe(false);

    // Handled edge case: spot price 0
    const devZero = calculatePriceDeviation(100, 0);
    expect(devZero.deviationPct).toBe(0);
    expect(devZero.deviationBps).toBe(0);
    expect(devZero.isDeviated).toBe(false);
  });
});

describe("OracleHealthPill Component", () => {
  it("renders Active pill with correct styling and data attribute", () => {
    render(<OracleHealthPill status="active" latencySec={25} />);
    const pill = screen.getByTestId("oracle-health-pill");
    expect(pill).toHaveAttribute("data-status", "active");
    expect(pill).toHaveTextContent(/active/i);
    expect(pill).toHaveTextContent(/25s ago/i);
  });

  it("renders Stale pill with > 300s styling", () => {
    render(<OracleHealthPill status="stale" latencySec={450} />);
    const pill = screen.getByTestId("oracle-health-pill");
    expect(pill).toHaveAttribute("data-status", "stale");
    expect(pill).toHaveTextContent(/stale/i);
    expect(pill).toHaveTextContent(/7m ago/i);
  });

  it("renders Down pill with > 1800s styling", () => {
    render(<OracleHealthPill status="down" latencySec={2400} />);
    const pill = screen.getByTestId("oracle-health-pill");
    expect(pill).toHaveAttribute("data-status", "down");
    expect(pill).toHaveTextContent(/down/i);
    expect(pill).toHaveTextContent(/40m ago/i);
  });
});

describe("OracleStatusWidget Component", () => {
  const fixedNow = 1700000000000;

  const mockFeeds: OracleFeedData[] = [
    {
      id: "xlm-test",
      name: "XLM / USD",
      asset: "XLM",
      oraclePrice: 0.125,
      spotPrice: 0.124,
      lastUpdatedAt: fixedNow - 20 * 1000, // 20s (< 60s -> Active)
    },
    {
      id: "btc-test",
      name: "BTC / USD",
      asset: "BTC",
      oraclePrice: 65000,
      spotPrice: 65500,
      lastUpdatedAt: fixedNow - 500 * 1000, // 500s (> 300s -> Stale)
    },
    {
      id: "eth-test",
      name: "ETH / USD",
      asset: "ETH",
      oraclePrice: 3400,
      spotPrice: 3500,
      lastUpdatedAt: fixedNow - 2000 * 1000, // 2000s (> 1800s -> Down)
    },
  ];

  it("renders widget header and feed tabs", () => {
    render(<OracleStatusWidget feeds={mockFeeds} now={fixedNow} />);

    expect(screen.getByTestId("oracle-status-widget")).toBeInTheDocument();
    expect(
      screen.getByText("Oracle Feed Latency & Price Deviation Monitor"),
    ).toBeInTheDocument();

    expect(screen.getByTestId("feed-tab-xlm-test")).toBeInTheDocument();
    expect(screen.getByTestId("feed-tab-btc-test")).toBeInTheDocument();
    expect(screen.getByTestId("feed-tab-eth-test")).toBeInTheDocument();
  });

  it("displays visual staleness alert when feeds exceed 300s threshold", () => {
    render(<OracleStatusWidget feeds={mockFeeds} now={fixedNow} />);

    const alert = screen.getByTestId("feed-staleness-alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(/Oracle Staleness Alert/i);
    expect(alert).toHaveTextContent(/BTC \/ USD/i);
    expect(alert).toHaveTextContent(/ETH \/ USD/i);
  });

  it("does not show staleness alert when all feeds are healthy (< 60s)", () => {
    const allHealthyFeeds: OracleFeedData[] = [
      {
        id: "healthy-1",
        name: "XLM / USD",
        asset: "XLM",
        oraclePrice: 0.125,
        spotPrice: 0.1248,
        lastUpdatedAt: fixedNow - 10 * 1000,
      },
      {
        id: "healthy-2",
        name: "BTC / USD",
        asset: "BTC",
        oraclePrice: 65000,
        spotPrice: 65020,
        lastUpdatedAt: fixedNow - 25 * 1000,
      },
    ];

    render(<OracleStatusWidget feeds={allHealthyFeeds} now={fixedNow} />);
    expect(screen.queryByTestId("feed-staleness-alert")).not.toBeInTheDocument();
  });

  it("renders real-time price deviation SVG graph and metric cards", () => {
    render(<OracleStatusWidget feeds={mockFeeds} now={fixedNow} />);

    // SVG graph
    const graph = screen.getByTestId("price-deviation-graph");
    expect(graph).toBeInTheDocument();
    expect(graph).toHaveAttribute("viewBox", "0 0 560 230");

    // Price deviation metric
    const devMetric = screen.getByTestId("price-deviation-metric");
    expect(devMetric).toBeInTheDocument();
    expect(devMetric).toHaveTextContent(/spread/i);

    // Feed latency metric
    const latencyMetric = screen.getByTestId("feed-latency-metric");
    expect(latencyMetric).toBeInTheDocument();
    expect(latencyMetric).toHaveTextContent(/Max staleness: 300s/i);
  });

  it("switches selected feed when clicking a feed tab", () => {
    render(<OracleStatusWidget feeds={mockFeeds} now={fixedNow} />);

    // Initially XLM is selected
    expect(screen.getByText("Asset: XLM")).toBeInTheDocument();

    // Click BTC tab
    const btcTab = screen.getByTestId("feed-tab-btc-test");
    fireEvent.click(btcTab);

    // Now BTC is selected
    expect(screen.getByText("Asset: BTC")).toBeInTheDocument();
    expect(screen.getByText("$65,000.00")).toBeInTheDocument();
  });
});
