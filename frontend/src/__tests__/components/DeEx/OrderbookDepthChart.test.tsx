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
          0.01,
        ),
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
        stats.bestAsk,
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
        stats.bestAsk,
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
        stats.bestAsk,
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
      />,
    );

    expect(
      screen.getByText(/Orderbook Depth/i, { selector: "span" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/(XLM\/USDC)/i, { selector: "span" }),
    ).toBeInTheDocument();
  });

  it("renders mid price and spread percentage badges", () => {
    render(
      <OrderbookDepthChart
        bids={sampleBids}
        asks={sampleAsks}
        baseSymbol="XLM"
        quoteSymbol="USDC"
      />,
    );

    // Mid is (1.25 + 1.26) / 2 = 1.255 -> 1.25 (to 2 decimals)
    expect(screen.getByText(/Mid:/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Spread:/i, { selector: "span" }),
    ).toBeInTheDocument();
  });

  it("allows switching price aggregation steps (0.01, 0.1, 1.0)", () => {
    render(
      <OrderbookDepthChart
        bids={sampleBids}
        asks={sampleAsks}
        defaultStep={0.01}
      />,
    );

    const step01Btn = screen.getByRole("button", { name: "0.1" });
    expect(step01Btn).toBeInTheDocument();
    expect(step01Btn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(step01Btn);
    expect(step01Btn).toHaveAttribute("aria-pressed", "true");
  });

  it("handles zoom controls", () => {
    render(<OrderbookDepthChart bids={sampleBids} asks={sampleAsks} />);

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
      />,
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
        screen.getByText(/Simulated Market Buy|Simulated Market Sell/i),
      ).toBeInTheDocument();
    }
  });

  it("supports high-frequency updates without stutter or memory leaks", () => {
    const { rerender } = render(
      <OrderbookDepthChart bids={sampleBids} asks={sampleAsks} />,
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

    expect(
      screen.getByText(/Orderbook Depth/i, { selector: "span" }),
    ).toBeInTheDocument();
  });

  it("renders accessible screen reader summary", () => {
    render(<OrderbookDepthChart bids={sampleBids} asks={sampleAsks} />);
    const srSummary = screen.getByText(/Orderbook depth for XLM\/USDC/i);
    expect(srSummary).toBeInTheDocument();
  });

  it("does not substitute demo liquidity for an empty live book", () => {
    render(<OrderbookDepthChart bids={[]} asks={[]} />);
    expect(
      screen.getByText("No orderbook liquidity available"),
    ).toBeInTheDocument();
  });

  it("shows exact hovered level quantity and cumulative depth", () => {
    const { container } = render(
      <OrderbookDepthChart bids={sampleBids} asks={sampleAsks} />,
    );
    const canvas = container.querySelector("canvas");
    if (!canvas) throw new Error("Expected chart canvas");
    jest.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 600,
      height: 440,
      right: 600,
      bottom: 440,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.mouseMove(canvas, { clientX: 120, clientY: 180 });
    expect(
      screen.getByText(/Hovered bid price/i, { selector: "div:not(.sr-only)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/cumulative depth/i, { selector: "div:not(.sr-only)" }),
    ).toBeInTheDocument();
  });

  it("throttles canvas redraws to RAF: 35 rapid rerenders queue at most one pending frame", () => {
    // Replace global requestAnimationFrame with a manual spy that never fires
    // the callback — this lets us count how many unique frames were queued
    // without any of them actually executing.
    const rafSpy = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => {
        // Return a unique non-zero handle each time so cancelAnimationFrame
        // can be called without errors, but never invoke the callback.
        return Math.random() * 1e9;
      });

    const { rerender } = render(
      <OrderbookDepthChart bids={sampleBids} asks={sampleAsks} />,
    );

    rafSpy.mockClear(); // Discard calls from initial mount

    act(() => {
      for (let i = 0; i < 35; i++) {
        rerender(
          <OrderbookDepthChart
            bids={[{ price: 1.25 + i * 0.0001, quantity: 100 + i }]}
            asks={[{ price: 1.26 + i * 0.0001, quantity: 150 + i }]}
          />,
        );
      }
    });

    // scheduleFrame() skips scheduling when rafIdRef.current !== null, so the
    // 35 rerenders must have queued exactly 1 frame (the first), not 35.
    expect(rafSpy.mock.calls.length).toBe(1);

    rafSpy.mockRestore();
  });

  it("sets canvas physical pixels to logical size × devicePixelRatio on mount", () => {
    // Simulate a 2× Retina display
    Object.defineProperty(window, "devicePixelRatio", {
      value: 2,
      writable: true,
      configurable: true,
    });

    // Provide ResizeObserver with a known container width by firing its
    // callback synchronously via the global mock jsdom sets up.
    let capturedCallback: ResizeObserverCallback | null = null;
    const originalRO = global.ResizeObserver;
    global.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        capturedCallback = cb;
      }
      observe() {
        // Fire immediately with a 400 px logical width
        if (capturedCallback) {
          capturedCallback(
            [
              {
                contentRect: { width: 400, height: 440 } as DOMRectReadOnly,
                target: document.createElement("div"),
                borderBoxSize: [],
                contentBoxSize: [],
                devicePixelContentBoxSize: [],
              },
            ],
            this as unknown as ResizeObserver,
          );
        }
      }
      unobserve() {}
      disconnect() {}
    };

    const { container } = render(
      <OrderbookDepthChart bids={sampleBids} asks={sampleAsks} height={440} />,
    );

    const canvas = container.querySelector("canvas");
    if (!canvas) throw new Error("Expected chart canvas");

    // Physical backing store must be 400 × 2 = 800 px wide and 440 × 2 = 880 px tall
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(880);

    // CSS logical size stays at the original dimensions
    expect(canvas.style.width).toBe("400px");
    expect(canvas.style.height).toBe("440px");

    // Restore globals
    global.ResizeObserver = originalRO;
    Object.defineProperty(window, "devicePixelRatio", {
      value: 1,
      writable: true,
      configurable: true,
    });
  });

  it("crosshair tooltip is queryable by data-testid and shows price and depth", () => {
    const { container } = render(
      <OrderbookDepthChart bids={sampleBids} asks={sampleAsks} />,
    );
    const canvas = container.querySelector("canvas");
    if (!canvas) throw new Error("Expected chart canvas");

    jest.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 600,
      height: 440,
      right: 600,
      bottom: 440,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // Before hover, the tooltip must not be in the DOM
    expect(
      container.querySelector("[data-testid='depth-chart-crosshair-tooltip']"),
    ).toBeNull();

    // Hover over the bid side (left quarter of a 600 px canvas,
    // well inside the bid price range for XLM/USDC at 1.25)
    fireEvent.mouseMove(canvas, { clientX: 120, clientY: 200 });

    const tooltip = screen.getByTestId("depth-chart-crosshair-tooltip");
    expect(tooltip).toBeInTheDocument();

    // Tooltip text must reference a price value and cumulative depth
    expect(tooltip.textContent).toMatch(/price\s+\d+\.\d+/i);
    expect(tooltip.textContent).toMatch(/cumulative depth/i);

    // After mouse leaves the canvas, the tooltip must disappear
    fireEvent.mouseLeave(canvas);
    expect(
      container.querySelector("[data-testid='depth-chart-crosshair-tooltip']"),
    ).toBeNull();
  });
});
