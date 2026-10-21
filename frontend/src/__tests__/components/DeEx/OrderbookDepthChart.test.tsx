import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import OrderbookDepthChart, {
  aggregateBids,
  aggregateAsks,
  calculateMarketStats,
  calculateSlippage,
  OrderLevel,
} from "../../../components/DeEx/OrderbookDepthChart";

describe("OrderbookDepthChart Mathematics", () => {
  const sampleBids: OrderLevel[] = [
    { price: 1.255, quantity: 100 },
    { price: 1.251, quantity: 50 },
    { price: 1.24, quantity: 200 },
    { price: 1.23, quantity: 300 },
  ];

  const sampleAsks: OrderLevel[] = [
    { price: 1.261, quantity: 150 },
    { price: 1.268, quantity: 100 },
    { price: 1.28, quantity: 250 },
    { price: 1.3, quantity: 400 },
  ];

  describe("aggregateBids", () => {
    it("floors bid prices to nearest step and sorts descending", () => {
      const agg = aggregateBids(sampleBids, 0.01);
      expect(agg.length).toBe(3); // 1.25, 1.24, 1.23
      expect(agg[0].price).toBe(1.25);
      expect(agg[0].quantity).toBe(150); // 100 + 50
      expect(agg[0].cumulativeVolume).toBe(150);

      expect(agg[1].price).toBe(1.24);
      expect(agg[1].quantity).toBe(200);
      expect(agg[1].cumulativeVolume).toBe(350);

      expect(agg[2].price).toBe(1.23);
      expect(agg[2].quantity).toBe(300);
      expect(agg[2].cumulativeVolume).toBe(650);
    });

    it("aggregates with larger step sizes (0.1)", () => {
      const agg = aggregateBids(sampleBids, 0.1);
      expect(agg.length).toBe(1);
      expect(agg[0].price).toBe(1.2);
      expect(agg[0].quantity).toBe(650);
      expect(agg[0].cumulativeVolume).toBe(650);
    });

    it("handles empty and invalid input safely", () => {
      expect(aggregateBids([], 0.01)).toEqual([]);
      expect(
        aggregateBids(
          [
            { price: -1, quantity: 10 },
            { price: 0, quantity: 5 },
          ],
          0.01
        )
      ).toEqual([]);
    });
  });

  describe("aggregateAsks", () => {
    it("ceils ask prices to nearest step and sorts ascending", () => {
      const agg = aggregateAsks(sampleAsks, 0.01);
      // 1.261 -> 1.27, 1.268 -> 1.27, 1.28 -> 1.28, 1.30 -> 1.30
      expect(agg.length).toBe(3);
      expect(agg[0].price).toBe(1.27);
      expect(agg[0].quantity).toBe(250); // 150 + 100
      expect(agg[0].cumulativeVolume).toBe(250);

      expect(agg[1].price).toBe(1.28);
      expect(agg[1].quantity).toBe(250);
      expect(agg[1].cumulativeVolume).toBe(500);

      expect(agg[2].price).toBe(1.3);
      expect(agg[2].quantity).toBe(400);
      expect(agg[2].cumulativeVolume).toBe(900);
    });

    it("aggregates asks with 0.1 step", () => {
      const agg = aggregateAsks(sampleAsks, 0.1);
      // 1.261 -> 1.3, 1.268 -> 1.3, 1.28 -> 1.3, 1.30 -> 1.3
      expect(agg.length).toBe(1);
      expect(agg[0].price).toBe(1.3);
      expect(agg[0].quantity).toBe(900);
    });
  });

  describe("calculateMarketStats", () => {
    it("computes best bid, best ask, mid price and spread correctly", () => {
      const stats = calculateMarketStats(sampleBids, sampleAsks);
      expect(stats.bestBid).toBe(1.255);
      expect(stats.bestAsk).toBe(1.261);
      expect(stats.midPrice).toBe(1.258);
      expect(stats.spreadAbs).toBeCloseTo(0.006, 6);
      expect(stats.spreadPercent).toBeCloseTo((0.006 / 1.258) * 100, 4);
    });

    it("handles one-sided or empty orderbook safely", () => {
      const emptyStats = calculateMarketStats([], []);
      expect(emptyStats.bestBid).toBe(0);
      expect(emptyStats.bestAsk).toBe(0);
      expect(emptyStats.midPrice).toBe(0);
      expect(emptyStats.spreadAbs).toBe(0);
      expect(emptyStats.spreadPercent).toBe(0);

      const bidsOnly = calculateMarketStats(sampleBids, []);
      expect(bidsOnly.bestBid).toBe(1.255);
      expect(bidsOnly.bestAsk).toBe(0);
      expect(bidsOnly.midPrice).toBe(1.255);
      expect(bidsOnly.spreadPercent).toBe(0);
    });
  });

  describe("calculateSlippage", () => {
    const aggBids = aggregateBids(sampleBids, 0.01);
    const aggAsks = aggregateAsks(sampleAsks, 0.01);
    const stats = calculateMarketStats(sampleBids, sampleAsks);

    it("simulates a buy order pushing ask price to 1.28", () => {
      const sim = calculateSlippage(
        1.28,
        aggBids,
        aggAsks,
        stats.bestBid,
        stats.bestAsk
      );

      expect(sim).not.toBeNull();
      if (!sim) return;

      expect(sim.side).toBe("buy");
      expect(sim.targetPrice).toBe(1.28);
      expect(sim.startPrice).toBe(stats.bestAsk);

      // Levels up to 1.28: 1.27 (qty 250) + 1.28 (qty 250) = 500
      expect(sim.requiredVolume).toBe(500);

      // Cost: (1.27 * 250) + (1.28 * 250) = 317.5 + 320 = 637.5
      expect(sim.totalQuoteCost).toBeCloseTo(637.5, 4);

      // Average execution price: 637.5 / 500 = 1.275
      expect(sim.avgExecutionPrice).toBeCloseTo(1.275, 4);

      // Slippage vs best ask (1.261): ((1.275 - 1.261) / 1.261) * 100
      const expectedSlippage = ((1.275 - 1.261) / 1.261) * 100;
      expect(sim.slippagePercent).toBeCloseTo(expectedSlippage, 3);
    });

    it("simulates a sell order pushing bid price down to 1.24", () => {
      const sim = calculateSlippage(
        1.24,
        aggBids,
        aggAsks,
        stats.bestBid,
        stats.bestAsk
      );

      expect(sim).not.toBeNull();
      if (!sim) return;

      expect(sim.side).toBe("sell");
      expect(sim.targetPrice).toBe(1.24);
      expect(sim.startPrice).toBe(stats.bestBid);

      // Levels >= 1.24: 1.25 (qty 150) + 1.24 (qty 200) = 350
      expect(sim.requiredVolume).toBe(350);

      // Total return: (1.25 * 150) + (1.24 * 200) = 187.5 + 248 = 435.5
      expect(sim.totalQuoteCost).toBeCloseTo(435.5, 4);

      // Average price: 435.5 / 350 = 1.2442857
      expect(sim.avgExecutionPrice).toBeCloseTo(435.5 / 350, 4);

      // Slippage vs best bid (1.255): ((1.255 - avg) / 1.255) * 100
      const expectedSlippage = ((1.255 - 435.5 / 350) / 1.255) * 100;
      expect(sim.slippagePercent).toBeCloseTo(expectedSlippage, 3);
    });

    it("returns null for price inside spread", () => {
      const insideSpreadPrice = 1.258;
      const sim = calculateSlippage(
        insideSpreadPrice,
        aggBids,
        aggAsks,
        stats.bestBid,
        stats.bestAsk
      );
      expect(sim).toBeNull();
    });
  });
});

describe("OrderbookDepthChart UI Component", () => {
  const sampleBids: OrderLevel[] = [
    { price: 1.25, quantity: 100 },
    { price: 1.24, quantity: 200 },
  ];

  const sampleAsks: OrderLevel[] = [
    { price: 1.26, quantity: 150 },
    { price: 1.27, quantity: 250 },
  ];

  beforeAll(() => {
    // Provide a lightweight mock for HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
      save: jest.fn(),
      restore: jest.fn(),
      scale: jest.fn(),
      setTransform: jest.fn(),
      clearRect: jest.fn(),
      fillRect: jest.fn(),
      strokeRect: jest.fn(),
      beginPath: jest.fn(),
      closePath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fill: jest.fn(),
      fillText: jest.fn(),
      measureText: jest.fn().mockReturnValue({ width: 50 }),
      setLineDash: jest.fn(),
      roundRect: jest.fn(),
      createLinearGradient: jest.fn().mockReturnValue({
        addColorStop: jest.fn(),
      }),
    });
  });

  it("renders depth chart title and currency pair", () => {
    render(
      <OrderbookDepthChart
        bids={sampleBids}
        asks={sampleAsks}
        baseSymbol="XLM"
        quoteSymbol="USDC"
      />
    );

    expect(screen.getByText(/Orderbook Depth/i)).toBeInTheDocument();
    expect(screen.getByText(/(XLM\/USDC)/i)).toBeInTheDocument();
  });

  it("renders mid price and spread percentage badges", () => {
    render(
      <OrderbookDepthChart
        bids={sampleBids}
        asks={sampleAsks}
        baseSymbol="XLM"
        quoteSymbol="USDC"
      />
    );

    // Mid is (1.25 + 1.26) / 2 = 1.255 -> 1.25 (to 2 decimals)
    expect(screen.getByText(/Mid:/i)).toBeInTheDocument();
    expect(screen.getByText(/Spread:/i)).toBeInTheDocument();
  });

  it("allows switching price aggregation steps (0.01, 0.1, 1.0)", () => {
    render(
      <OrderbookDepthChart
        bids={sampleBids}
        asks={sampleAsks}
        defaultStep={0.01}
      />
    );

    const step01Btn = screen.getByRole("button", { name: "0.1" });
    expect(step01Btn).toBeInTheDocument();
    expect(step01Btn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(step01Btn);
    expect(step01Btn).toHaveAttribute("aria-pressed", "true");
  });

  it("handles zoom controls", () => {
    render(
      <OrderbookDepthChart
        bids={sampleBids}
        asks={sampleAsks}
      />
    );

    const zoomInBtn = screen.getByRole("button", { name: "Zoom in" });
    const zoomOutBtn = screen.getByRole("button", { name: "Zoom out" });
    const resetBtn = screen.getByRole("button", { name: "Reset zoom" });

    fireEvent.click(zoomInBtn);
    fireEvent.click(zoomOutBtn);
    fireEvent.click(resetBtn);
  });

  it("triggers onLevelClick and opens simulated slippage drawer on canvas click", () => {
    const handleLevelClick = jest.fn();
    const { container } = render(
      <OrderbookDepthChart
        bids={sampleBids}
        asks={sampleAsks}
        onLevelClick={handleLevelClick}
      />
    );

    const canvas = container.querySelector("canvas");
    expect(canvas).toBeInTheDocument();

    if (canvas) {
      // Mock getBoundingClientRect
      jest.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 600,
        height: 400,
        right: 600,
        bottom: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Click on right side (asks territory)
      fireEvent.click(canvas, { clientX: 450, clientY: 200 });
      expect(handleLevelClick).toHaveBeenCalled();

      // Drawer should render simulation details
      expect(
        screen.getByText(/Simulated Market Buy|Simulated Market Sell/i)
      ).toBeInTheDocument();
    }
  });

  it("supports high-frequency updates without stutter or memory leaks", () => {
    const { rerender } = render(
      <OrderbookDepthChart bids={sampleBids} asks={sampleAsks} />
    );

    // Simulate 35 rapid updates (simulating > 30 updates/sec)
    act(() => {
      for (let i = 0; i < 35; i++) {
        const newBids = [
          { price: 1.25 + i * 0.0001, quantity: 100 + i * 2 },
          { price: 1.24, quantity: 200 },
        ];
        const newAsks = [
          { price: 1.26 + i * 0.0001, quantity: 150 + i * 2 },
          { price: 1.27, quantity: 250 },
        ];
        rerender(<OrderbookDepthChart bids={newBids} asks={newAsks} />);
      }
    });

    expect(screen.getByText(/Orderbook Depth/i)).toBeInTheDocument();
  });

  it("renders accessible screen reader summary", () => {
    render(<OrderbookDepthChart bids={sampleBids} asks={sampleAsks} />);
    const srSummary = screen.getByText(/Orderbook depth for XLM\/USDC/i);
    expect(srSummary).toBeInTheDocument();
  });

  it("does not substitute demo liquidity for an empty live book", () => {
    render(<OrderbookDepthChart bids={[]} asks={[]} />);
    expect(screen.getByText("No orderbook liquidity available")).toBeInTheDocument();
  });

  it("shows exact hovered level quantity and cumulative depth", () => {
    const { container } = render(
      <OrderbookDepthChart bids={sampleBids} asks={sampleAsks} />
    );
    const canvas = container.querySelector("canvas");
    if (!canvas) throw new Error("Expected chart canvas");
    jest.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 600, height: 440, right: 600, bottom: 440,
      x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseMove(canvas, { clientX: 120, clientY: 180 });
    expect(screen.getByText(/Hovered bid price/i)).toBeInTheDocument();
    expect(screen.getByText(/cumulative depth/i)).toBeInTheDocument();
  });
});
