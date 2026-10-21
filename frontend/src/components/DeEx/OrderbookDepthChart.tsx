"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  SlidersHorizontal,
  TrendingUp,
  TrendingDown,
  Info,
  CheckCircle2,
  X,
} from "lucide-react";

// ── Types & Interfaces ────────────────────────────────────────────────────────

export interface OrderLevel {
  price: number;
  quantity: number;
}

export interface AggregatedLevel {
  price: number;
  quantity: number;
  cumulativeVolume: number;
  cumulativeQuote: number;
}

export interface MarketStats {
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  spreadAbs: number;
  spreadPercent: number;
}

export interface SlippageSimulation {
  targetPrice: number;
  startPrice: number;
  side: "buy" | "sell";
  requiredVolume: number;
  totalQuoteCost: number;
  avgExecutionPrice: number;
  slippagePercent: number;
  priceImpactPercent: number;
}

export interface OrderbookDepthChartProps {
  bids?: OrderLevel[];
  asks?: OrderLevel[];
  baseSymbol?: string;
  quoteSymbol?: string;
  defaultStep?: number;
  className?: string;
  height?: number;
  onLevelClick?: (simulation: SlippageSimulation) => void;
  showControls?: boolean;
  demoMode?: boolean;
}

interface HoverState {
  x: number;
  y: number;
  price: number;
  volume: number;
  cumulativeVolume: number;
  side: "bid" | "ask" | "spread";
}

interface FlashGlow {
  timestamp: number;
  side: "bid" | "ask";
  intensity: number;
}

// ── Mathematical Core & Pure Utility Functions ───────────────────────────────

/**
 * Aggregates buy orders into discrete price buckets.
 * Bids are floored to the nearest step tick so users observe conservative liquidation tiers,
 * and sorted in descending order (highest bid first).
 */
export function aggregateBids(
  bids: OrderLevel[],
  step: number
): AggregatedLevel[] {
  if (!bids || bids.length === 0 || step <= 0) return [];

  const bucketMap = new Map<number, number>();
  for (let i = 0; i < bids.length; i++) {
    const order = bids[i];
    if (order.price <= 0 || order.quantity <= 0) continue;
    // Round to avoid floating point precision artifacts (e.g. 0.30000000000000004)
    const rawBucket = Math.floor(order.price / step) * step;
    const bucket = Number(rawBucket.toFixed(6));
    bucketMap.set(bucket, (bucketMap.get(bucket) || 0) + order.quantity);
  }

  // Sort descending: highest bid to lowest bid
  const sortedPrices = Array.from(bucketMap.keys()).sort((a, b) => b - a);

  let cumulativeVolume = 0;
  let cumulativeQuote = 0;
  const result: AggregatedLevel[] = new Array(sortedPrices.length);

  for (let i = 0; i < sortedPrices.length; i++) {
    const price = sortedPrices[i];
    const quantity = bucketMap.get(price) || 0;
    cumulativeVolume += quantity;
    cumulativeQuote += price * quantity;
    result[i] = {
      price,
      quantity,
      cumulativeVolume,
      cumulativeQuote,
    };
  }

  return result;
}

/**
 * Aggregates sell orders into discrete price buckets.
 * Asks are ceiled to the nearest step tick and sorted ascending (lowest ask first).
 */
export function aggregateAsks(
  asks: OrderLevel[],
  step: number
): AggregatedLevel[] {
  if (!asks || asks.length === 0 || step <= 0) return [];

  const bucketMap = new Map<number, number>();
  for (let i = 0; i < asks.length; i++) {
    const order = asks[i];
    if (order.price <= 0 || order.quantity <= 0) continue;
    const rawBucket = Math.ceil(order.price / step) * step;
    const bucket = Number(rawBucket.toFixed(6));
    bucketMap.set(bucket, (bucketMap.get(bucket) || 0) + order.quantity);
  }

  // Sort ascending: lowest ask to highest ask
  const sortedPrices = Array.from(bucketMap.keys()).sort((a, b) => a - b);

  let cumulativeVolume = 0;
  let cumulativeQuote = 0;
  const result: AggregatedLevel[] = new Array(sortedPrices.length);

  for (let i = 0; i < sortedPrices.length; i++) {
    const price = sortedPrices[i];
    const quantity = bucketMap.get(price) || 0;
    cumulativeVolume += quantity;
    cumulativeQuote += price * quantity;
    result[i] = {
      price,
      quantity,
      cumulativeVolume,
      cumulativeQuote,
    };
  }

  return result;
}

/**
 * Calculates current mid-market price, absolute spread, and relative spread percentage.
 */
export function calculateMarketStats(
  bids: OrderLevel[],
  asks: OrderLevel[]
): MarketStats {
  const validBids = bids.filter((b) => b.price > 0 && b.quantity > 0);
  const validAsks = asks.filter((a) => a.price > 0 && a.quantity > 0);

  let bestBid = 0;
  for (let i = 0; i < validBids.length; i++) {
    if (validBids[i].price > bestBid) bestBid = validBids[i].price;
  }

  let bestAsk = Infinity;
  for (let i = 0; i < validAsks.length; i++) {
    if (validAsks[i].price < bestAsk) bestAsk = validAsks[i].price;
  }
  if (bestAsk === Infinity) bestAsk = 0;

  let midPrice = 0;
  if (bestBid > 0 && bestAsk > 0) {
    midPrice = (bestBid + bestAsk) / 2;
  } else if (bestBid > 0) {
    midPrice = bestBid;
  } else if (bestAsk > 0) {
    midPrice = bestAsk;
  }

  const spreadAbs =
    bestBid > 0 && bestAsk > 0 ? Math.max(0, bestAsk - bestBid) : 0;
  const spreadPercent =
    midPrice > 0 ? (spreadAbs / midPrice) * 100 : 0;

  return {
    bestBid,
    bestAsk,
    midPrice,
    spreadAbs,
    spreadPercent,
  };
}

/**
 * Simulates Soroban CLOB/AMM market trade execution slippage required
 * to sweep resting orders and push the market to `targetPrice`.
 */
export function calculateSlippage(
  targetPrice: number,
  aggregatedBids: AggregatedLevel[],
  aggregatedAsks: AggregatedLevel[],
  bestBid: number,
  bestAsk: number
): SlippageSimulation | null {
  if (targetPrice <= 0) return null;

  // Buying scenario: Target price pushes into Asks (targetPrice >= bestAsk)
  if (bestAsk > 0 && targetPrice >= bestAsk) {
    let requiredVolume = 0;
    let totalQuoteCost = 0;

    for (let i = 0; i < aggregatedAsks.length; i++) {
      const level = aggregatedAsks[i];
      if (level.price <= targetPrice) {
        requiredVolume += level.quantity;
        totalQuoteCost += level.price * level.quantity;
      } else {
        break;
      }
    }

    if (requiredVolume <= 0) return null;

    const avgExecutionPrice = totalQuoteCost / requiredVolume;
    const slippagePercent = ((avgExecutionPrice - bestAsk) / bestAsk) * 100;
    const priceImpactPercent = ((targetPrice - bestAsk) / bestAsk) * 100;

    return {
      targetPrice,
      startPrice: bestAsk,
      side: "buy",
      requiredVolume,
      totalQuoteCost,
      avgExecutionPrice,
      slippagePercent: Math.max(0, slippagePercent),
      priceImpactPercent: Math.max(0, priceImpactPercent),
    };
  }

  // Selling scenario: Target price pushes into Bids (targetPrice <= bestBid)
  if (bestBid > 0 && targetPrice <= bestBid) {
    let requiredVolume = 0;
    let totalQuoteCost = 0;

    for (let i = 0; i < aggregatedBids.length; i++) {
      const level = aggregatedBids[i];
      if (level.price >= targetPrice) {
        requiredVolume += level.quantity;
        totalQuoteCost += level.price * level.quantity;
      } else {
        break;
      }
    }

    if (requiredVolume <= 0) return null;

    const avgExecutionPrice = totalQuoteCost / requiredVolume;
    const slippagePercent = ((bestBid - avgExecutionPrice) / bestBid) * 100;
    const priceImpactPercent = ((bestBid - targetPrice) / bestBid) * 100;

    return {
      targetPrice,
      startPrice: bestBid,
      side: "sell",
      requiredVolume,
      totalQuoteCost,
      avgExecutionPrice,
      slippagePercent: Math.max(0, slippagePercent),
      priceImpactPercent: Math.max(0, priceImpactPercent),
    };
  }

  return null;
}

// ── Realistic Demo Order Generator ───────────────────────────────────────────

function generateDemoOrders(): { bids: OrderLevel[]; asks: OrderLevel[] } {
  const mid = 1.25;
  const bids: OrderLevel[] = [];
  const asks: OrderLevel[] = [];

  for (let i = 1; i <= 35; i++) {
    const bidPrice = Number((mid - i * 0.008 - Math.random() * 0.002).toFixed(4));
    const askPrice = Number((mid + i * 0.008 + Math.random() * 0.002).toFixed(4));
    const bidQty = Math.round(50 + Math.random() * 120 + i * 15);
    const askQty = Math.round(50 + Math.random() * 120 + i * 15);

    if (bidPrice > 0) bids.push({ price: bidPrice, quantity: bidQty });
    if (askPrice > 0) asks.push({ price: askPrice, quantity: askQty });
  }

  return { bids, asks };
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function OrderbookDepthChart({
  bids: initialBids,
  asks: initialAsks,
  baseSymbol = "XLM",
  quoteSymbol = "USDC",
  defaultStep = 0.01,
  className = "",
  height = 440,
  onLevelClick,
  showControls = true,
  demoMode = false,
}: OrderbookDepthChartProps) {
  // Use demo data if incoming arrays are empty or demoMode is requested
  const [internalBook, setInternalBook] = useState<{
    bids: OrderLevel[];
    asks: OrderLevel[];
  }>(() => {
    if (demoMode) return generateDemoOrders();
    return { bids: initialBids || [], asks: initialAsks || [] };
  });

  // Sync external props when provided and not in standalone demo mode
  useEffect(() => {
    if (!demoMode) {
      setInternalBook({
        bids: initialBids || [],
        asks: initialAsks || [],
      });
    }
  }, [initialBids, initialAsks, demoMode]);

  // Controls state
  const [step, setStep] = useState<number>(defaultStep);
  const [zoom, setZoom] = useState<number>(1.0);
  const [selectedSimulation, setSelectedSimulation] =
    useState<SlippageSimulation | null>(null);
  const [hoverAnnouncement, setHoverAnnouncement] = useState("");

  // References
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const hoverRef = useRef<HoverState | null>(null);
  const flashesRef = useRef<Map<number, FlashGlow>>(new Map());
  const prevLevelsRef = useRef<Map<number, number>>(new Map());
  const dimensionsRef = useRef<{ width: number; height: number }>({
    width: 600,
    height,
  });

  // Aggregated depth data
  const aggregatedBids = useMemo(
    () => aggregateBids(internalBook.bids, step),
    [internalBook.bids, step]
  );
  const aggregatedAsks = useMemo(
    () => aggregateAsks(internalBook.asks, step),
    [internalBook.asks, step]
  );
  const stats = useMemo(
    () => calculateMarketStats(internalBook.bids, internalBook.asks),
    [internalBook.bids, internalBook.asks]
  );

  // Track volume deltas and trigger subtle flash glows
  useEffect(() => {
    const currentLevels = new Map<number, number>();
    const newFlashes = new Map<number, FlashGlow>(flashesRef.current);
    const now = Date.now();

    // Scan bids
    for (let i = 0; i < aggregatedBids.length; i++) {
      const b = aggregatedBids[i];
      currentLevels.set(b.price, b.quantity);
      const prevQty = prevLevelsRef.current.get(b.price);
      if (prevQty !== undefined && prevQty !== b.quantity) {
        newFlashes.set(b.price, { timestamp: now, side: "bid", intensity: 1.0 });
      }
    }

    // Scan asks
    for (let i = 0; i < aggregatedAsks.length; i++) {
      const a = aggregatedAsks[i];
      currentLevels.set(a.price, a.quantity);
      const prevQty = prevLevelsRef.current.get(a.price);
      if (prevQty !== undefined && prevQty !== a.quantity) {
        newFlashes.set(a.price, { timestamp: now, side: "ask", intensity: 1.0 });
      }
    }

    prevLevelsRef.current = currentLevels;
    flashesRef.current = newFlashes;
  }, [aggregatedBids, aggregatedAsks]);

  // ── High-Performance Canvas Rendering Loop ──────────────────────────────────

  const renderCanvas = useCallback(() => {
    rafIdRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height: chartHeight } = dimensionsRef.current;
    if (width <= 0 || chartHeight <= 0) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    // Synchronize canvas physical size with logical display scale
    if (canvas.width !== width * dpr || canvas.height !== chartHeight * dpr) {
      canvas.width = width * dpr;
      canvas.height = chartHeight * dpr;
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${chartHeight}px`;

    // Reset to logical pixel coordinates on every frame; canvas resizing resets
    // the context state, while setTransform also prevents accumulated scaling.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Layout Margins
    const padTop = 32;
    const padBottom = 42;
    const padLeft = 14;
    const padRight = 68; // Space for right Y-axis volume values
    const plotWidth = Math.max(10, width - padLeft - padRight);
    const plotHeight = Math.max(10, chartHeight - padTop - padBottom);

    // Clear frame
    ctx.clearRect(0, 0, width, chartHeight);

    // Draw background subtle grid & panel borders
    ctx.fillStyle = "#090d16"; // Rich obsidian dark background
    ctx.fillRect(0, 0, width, chartHeight);

    // Compute coordinate ranges
    const maxBidVol =
      aggregatedBids.length > 0
        ? aggregatedBids[aggregatedBids.length - 1].cumulativeVolume
        : 0;
    const maxAskVol =
      aggregatedAsks.length > 0
        ? aggregatedAsks[aggregatedAsks.length - 1].cumulativeVolume
        : 0;
    const maxVolume = Math.max(maxBidVol, maxAskVol, 1) * 1.15;

    // Price Bounds
    const lowestBid = aggregatedBids.length > 0
      ? aggregatedBids[aggregatedBids.length - 1].price
      : stats.bestBid;
    const highestAsk = aggregatedAsks.length > 0
      ? aggregatedAsks[aggregatedAsks.length - 1].price
      : stats.bestAsk;
    const rawSpan = highestAsk > 0 && lowestBid > 0
      ? highestAsk - lowestBid
      : Math.max(highestAsk, lowestBid) * 0.2;
    const fullPriceSpan = Math.max(0.001, rawSpan);
    const centerPrice = stats.midPrice || (highestAsk + lowestBid) / 2 || 1;
    const visibleSpan = fullPriceSpan / zoom;

    const minPrice = Math.max(0.0001, centerPrice - visibleSpan / 2);
    const maxPrice = centerPrice + visibleSpan / 2;
    const priceRange = maxPrice - minPrice;

    // Mapping Functions
    const priceToX = (p: number) =>
      padLeft + ((p - minPrice) / priceRange) * plotWidth;
    const volumeToY = (v: number) =>
      padTop + plotHeight - (v / maxVolume) * plotHeight;
    const xToPrice = (x: number) =>
      minPrice + ((x - padLeft) / plotWidth) * priceRange;

    // ── Gridlines & Axes ─────────────────────────────────────────────────────

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";

    // Horizontal Volume Grids (4 horizontal lines)
    ctx.fillStyle = "rgba(148, 163, 184, 0.5)";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";

    const volSteps = 4;
    for (let i = 1; i <= volSteps; i++) {
      const v = (maxVolume / volSteps) * i;
      const y = volumeToY(v);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotWidth, y);
      ctx.stroke();

      // Label on right Y-axis
      ctx.fillText(
        v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0),
        padLeft + plotWidth + 6,
        y + 3
      );
    }

    // Vertical Price Grids (5 vertical lines)
    ctx.textAlign = "center";
    const priceSteps = 6;
    for (let i = 0; i <= priceSteps; i++) {
      const p = minPrice + (priceRange / priceSteps) * i;
      const x = priceToX(p);
      if (x < padLeft || x > padLeft + plotWidth) continue;

      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotHeight);
      ctx.stroke();

      // Label on bottom X-axis
      ctx.fillText(p.toFixed(step < 0.1 ? 3 : 2), x, chartHeight - 16);
    }

    // ── Subtle Update Flash Glows ───────────────────────────────────────────

    const now = Date.now();
    const activeFlashes = flashesRef.current;
    activeFlashes.forEach((flash, price) => {
      const elapsed = now - flash.timestamp;
      if (elapsed > 400) {
        activeFlashes.delete(price);
        return;
      }
      const alpha = (1 - elapsed / 400) * 0.28;
      const x = priceToX(price);
      if (x >= padLeft && x <= padLeft + plotWidth) {
        const glowWidth = Math.max(6, plotWidth / (aggregatedBids.length + aggregatedAsks.length || 20));
        ctx.fillStyle =
          flash.side === "bid"
            ? `rgba(16, 185, 129, ${alpha})`
            : `rgba(239, 68, 68, ${alpha})`;
        ctx.fillRect(x - glowWidth / 2, padTop, glowWidth, plotHeight);
      }
    });

    // ── Stepped Cumulative Bids Curve (Green) ────────────────────────────────

    if (aggregatedBids.length > 0) {
      // Sort in visual left-to-right order (lowest bid to highest bid)
      const visualBids = [...aggregatedBids].sort((a, b) => a.price - b.price);

      ctx.beginPath();
      let firstX = priceToX(visualBids[0].price);
      firstX = Math.max(padLeft, Math.min(padLeft + plotWidth, firstX));
      ctx.moveTo(firstX, padTop + plotHeight);

      let currentY = volumeToY(visualBids[0].cumulativeVolume);
      ctx.lineTo(firstX, currentY);

      for (let i = 0; i < visualBids.length; i++) {
        const pt = visualBids[i];
        const nextPt = visualBids[i + 1];
        const ptX = priceToX(pt.price);
        currentY = volumeToY(pt.cumulativeVolume);

        if (nextPt) {
          const nextX = priceToX(nextPt.price);
          // Stepped line: horizontal first to next X, then vertical
          ctx.lineTo(nextX, currentY);
          ctx.lineTo(nextX, volumeToY(nextPt.cumulativeVolume));
        } else {
          // Last bid level (best bid)
          ctx.lineTo(ptX, currentY);
          ctx.lineTo(ptX, padTop + plotHeight);
        }
      }

      ctx.closePath();

      // Green Lush Depth Gradient Fill
      const bidGrad = ctx.createLinearGradient(0, padTop, 0, padTop + plotHeight);
      bidGrad.addColorStop(0, "rgba(16, 185, 129, 0.42)");
      bidGrad.addColorStop(0.7, "rgba(16, 185, 129, 0.12)");
      bidGrad.addColorStop(1, "rgba(16, 185, 129, 0.01)");
      ctx.fillStyle = bidGrad;
      ctx.fill();

      // Stroke Line
      ctx.beginPath();
      ctx.moveTo(firstX, volumeToY(visualBids[0].cumulativeVolume));
      for (let i = 0; i < visualBids.length; i++) {
        const nextPt = visualBids[i + 1];
        currentY = volumeToY(visualBids[i].cumulativeVolume);
        if (nextPt) {
          const nextX = priceToX(nextPt.price);
          ctx.lineTo(nextX, currentY);
          ctx.lineTo(nextX, volumeToY(nextPt.cumulativeVolume));
        } else {
          ctx.lineTo(priceToX(visualBids[i].price), currentY);
        }
      }
      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // ── Stepped Cumulative Asks Curve (Red) ─────────────────────────────────

    if (aggregatedAsks.length > 0) {
      // Ascending order: best ask to highest ask
      ctx.beginPath();
      const firstAskX = priceToX(aggregatedAsks[0].price);
      ctx.moveTo(firstAskX, padTop + plotHeight);

      let currentY = volumeToY(aggregatedAsks[0].cumulativeVolume);
      ctx.lineTo(firstAskX, currentY);

      for (let i = 0; i < aggregatedAsks.length; i++) {
        const pt = aggregatedAsks[i];
        const nextPt = aggregatedAsks[i + 1];
        currentY = volumeToY(pt.cumulativeVolume);

        if (nextPt) {
          const nextX = priceToX(nextPt.price);
          // Stepped line: horizontal first, then vertical
          ctx.lineTo(nextX, currentY);
          ctx.lineTo(nextX, volumeToY(nextPt.cumulativeVolume));
        } else {
          ctx.lineTo(priceToX(pt.price), currentY);
          ctx.lineTo(priceToX(pt.price), padTop + plotHeight);
        }
      }

      ctx.closePath();

      // Red Depth Gradient Fill
      const askGrad = ctx.createLinearGradient(0, padTop, 0, padTop + plotHeight);
      askGrad.addColorStop(0, "rgba(239, 68, 68, 0.42)");
      askGrad.addColorStop(0.7, "rgba(239, 68, 68, 0.12)");
      askGrad.addColorStop(1, "rgba(239, 68, 68, 0.01)");
      ctx.fillStyle = askGrad;
      ctx.fill();

      // Stroke Line
      ctx.beginPath();
      ctx.moveTo(firstAskX, volumeToY(aggregatedAsks[0].cumulativeVolume));
      for (let i = 0; i < aggregatedAsks.length; i++) {
        const nextPt = aggregatedAsks[i + 1];
        currentY = volumeToY(aggregatedAsks[i].cumulativeVolume);
        if (nextPt) {
          const nextX = priceToX(nextPt.price);
          ctx.lineTo(nextX, currentY);
          ctx.lineTo(nextX, volumeToY(nextPt.cumulativeVolume));
        } else {
          ctx.lineTo(priceToX(aggregatedAsks[i].price), currentY);
        }
      }
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // ── Mid-Market Price & Spread Line ──────────────────────────────────────

    if (stats.midPrice > 0) {
      const midX = priceToX(stats.midPrice);
      if (midX >= padLeft && midX <= padLeft + plotWidth) {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(56, 189, 248, 0.75)"; // Cyan spread marker
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(midX, padTop);
        ctx.lineTo(midX, padTop + plotHeight);
        ctx.stroke();
        ctx.setLineDash([]);

        // Mid badge pill on top
        const label = `Mid ${stats.midPrice.toFixed(2)} (${stats.spreadPercent.toFixed(2)}%)`;
        ctx.font = "bold 10px monospace";
        const txtWidth = ctx.measureText(label).width;
        const pillX = Math.max(
          padLeft + 6,
          Math.min(padLeft + plotWidth - txtWidth - 16, midX - txtWidth / 2 - 8)
        );

        ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
        ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
        ctx.beginPath();
        ctx.roundRect(pillX, padTop - 22, txtWidth + 16, 18, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#38bdf8";
        ctx.textAlign = "left";
        ctx.fillText(label, pillX + 8, padTop - 9);
      }
    }

    // ── Active Slippage Simulation Marker Highlight ──────────────────────────

    if (selectedSimulation) {
      const sim = selectedSimulation;
      const startX = priceToX(sim.startPrice);
      const targetX = priceToX(sim.targetPrice);

      const x1 = Math.min(startX, targetX);
      const x2 = Math.max(startX, targetX);
      const highlightWidth = Math.max(2, x2 - x1);

      // Shaded execution sweep area
      ctx.fillStyle =
        sim.side === "buy"
          ? "rgba(239, 68, 68, 0.18)"
          : "rgba(16, 185, 129, 0.18)";
      ctx.fillRect(x1, padTop, highlightWidth, plotHeight);

      // Boundary target vertical indicator line
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = sim.side === "buy" ? "#f43f5e" : "#10b981";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(targetX, padTop);
      ctx.lineTo(targetX, padTop + plotHeight);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Interactive Hover Crosshair & Axis Markers ───────────────────────────

    const hover = hoverRef.current;
    if (
      hover &&
      hover.x >= padLeft &&
      hover.x <= padLeft + plotWidth &&
      hover.y >= padTop &&
      hover.y <= padTop + plotHeight
    ) {
      // Vertical crosshair line
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hover.x, padTop);
      ctx.lineTo(hover.x, padTop + plotHeight);
      ctx.stroke();

      // Horizontal crosshair line
      ctx.beginPath();
      ctx.moveTo(padLeft, hover.y);
      ctx.lineTo(padLeft + plotWidth, hover.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Axis Price Badge (Bottom)
      const pLabel = hover.price.toFixed(step < 0.1 ? 3 : 2);
      ctx.font = "bold 10px monospace";
      const pTextWidth = ctx.measureText(pLabel).width;
      ctx.fillStyle = "#1e293b";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.beginPath();
      ctx.roundRect(hover.x - pTextWidth / 2 - 6, padTop + plotHeight + 4, pTextWidth + 12, 18, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f8fafc";
      ctx.textAlign = "center";
      ctx.fillText(pLabel, hover.x, padTop + plotHeight + 17);

      // Axis Volume Badge (Right)
      const vVal = ((padTop + plotHeight - hover.y) / plotHeight) * maxVolume;
      const vLabel = vVal >= 1000 ? `${(vVal / 1000).toFixed(1)}k` : vVal.toFixed(0);
      const vTextWidth = ctx.measureText(vLabel).width;
      ctx.fillStyle = "#1e293b";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.beginPath();
      ctx.roundRect(padLeft + plotWidth + 4, hover.y - 9, vTextWidth + 12, 18, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f8fafc";
      ctx.textAlign = "left";
      ctx.fillText(vLabel, padLeft + plotWidth + 10, hover.y + 4);

      // Exact level data beside the crosshair.
      const sideLabel = hover.side === "spread" ? "Spread" : `${hover.side.toUpperCase()} level`;
      const detail = `${sideLabel}  Qty ${hover.volume.toLocaleString()}  Depth ${hover.cumulativeVolume.toLocaleString()}`;
      ctx.font = "10px monospace";
      const detailWidth = ctx.measureText(detail).width;
      const detailX = Math.max(padLeft + 4, Math.min(padLeft + plotWidth - detailWidth - 16, hover.x + 12));
      const detailY = Math.max(padTop + 4, Math.min(padTop + plotHeight - 24, hover.y + 12));
      ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
      ctx.beginPath();
      ctx.roundRect(detailX, detailY, detailWidth + 12, 20, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f8fafc";
      ctx.textAlign = "left";
      ctx.fillText(detail, detailX + 6, detailY + 13);
    }

    // Re-request frame if any flashes are currently decaying
    if (activeFlashes.size > 0 && mountedRef.current && rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(renderCanvas);
    }
  }, [aggregatedBids, aggregatedAsks, stats, zoom, step, selectedSimulation]);

  // Request Animation Frame on state changes and release any pending frame on
  // rerender or unmount.
  useEffect(() => {
    mountedRef.current = true;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    renderCanvas();
    return () => {
      mountedRef.current = false;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [renderCanvas]);

  // Handle ResizeObserver for responsive layout & High-DPI support
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width } = entry.contentRect;
      if (width > 0) {
        dimensionsRef.current = { width, height };
        renderCanvas();
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [height, renderCanvas]);

  // ── Mouse & Touch Event Handlers ──────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const { width, height: chartHeight } = dimensionsRef.current;
      const padLeft = 14;
      const padRight = 68;
      const plotWidth = width - padLeft - padRight;

      const lowestBid = aggregatedBids.length > 0
        ? aggregatedBids[aggregatedBids.length - 1].price
        : stats.bestBid;
      const highestAsk = aggregatedAsks.length > 0
        ? aggregatedAsks[aggregatedAsks.length - 1].price
        : stats.bestAsk;
      const rawSpan = highestAsk > 0 && lowestBid > 0
        ? highestAsk - lowestBid
        : Math.max(highestAsk, lowestBid) * 0.2;
      const fullPriceSpan = Math.max(0.001, rawSpan);
      const centerPrice = stats.midPrice || (highestAsk + lowestBid) / 2 || 1;
      const visibleSpan = fullPriceSpan / zoom;
      const minPrice = Math.max(0.0001, centerPrice - visibleSpan / 2);
      const maxPrice = centerPrice + visibleSpan / 2;
      const priceRange = maxPrice - minPrice;

      const price = minPrice + ((mouseX - padLeft) / plotWidth) * priceRange;

      // Classify hover side
      let side: HoverState["side"] = "spread";
      let volume = 0;
      let cumulativeVolume = 0;

      if (stats.bestBid > 0 && price <= stats.bestBid) {
        side = "bid";
        // Find closest aggregated bid
        let closest = aggregatedBids[0];
        let minDist = Infinity;
        for (let i = 0; i < aggregatedBids.length; i++) {
          const dist = Math.abs(aggregatedBids[i].price - price);
          if (dist < minDist) {
            minDist = dist;
            closest = aggregatedBids[i];
          }
        }
        if (closest) {
          volume = closest.quantity;
          cumulativeVolume = closest.cumulativeVolume;
        }
      } else if (stats.bestAsk > 0 && price >= stats.bestAsk) {
        side = "ask";
        let closest = aggregatedAsks[0];
        let minDist = Infinity;
        for (let i = 0; i < aggregatedAsks.length; i++) {
          const dist = Math.abs(aggregatedAsks[i].price - price);
          if (dist < minDist) {
            minDist = dist;
            closest = aggregatedAsks[i];
          }
        }
        if (closest) {
          volume = closest.quantity;
          cumulativeVolume = closest.cumulativeVolume;
        }
      }

      hoverRef.current = {
        x: mouseX,
        y: mouseY,
        price,
        volume,
        cumulativeVolume,
        side,
      };
      setHoverAnnouncement(
        `Hovered ${side} price ${price.toFixed(4)}, quantity ${volume}, cumulative depth ${cumulativeVolume}.`
      );

      renderCanvas();
    },
    [aggregatedBids, aggregatedAsks, stats, zoom, renderCanvas]
  );

  const handleMouseLeave = useCallback(() => {
    hoverRef.current = null;
    setHoverAnnouncement("");
    renderCanvas();
  }, [renderCanvas]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;

      const { width } = dimensionsRef.current;
      const padLeft = 14;
      const padRight = 68;
      const plotWidth = width - padLeft - padRight;

      const lowestBid = aggregatedBids.length > 0
        ? aggregatedBids[aggregatedBids.length - 1].price
        : stats.bestBid;
      const highestAsk = aggregatedAsks.length > 0
        ? aggregatedAsks[aggregatedAsks.length - 1].price
        : stats.bestAsk;
      const rawSpan = highestAsk > 0 && lowestBid > 0
        ? highestAsk - lowestBid
        : Math.max(highestAsk, lowestBid) * 0.2;
      const fullPriceSpan = Math.max(0.001, rawSpan);
      const centerPrice = stats.midPrice || (highestAsk + lowestBid) / 2 || 1;
      const visibleSpan = fullPriceSpan / zoom;
      const minPrice = Math.max(0.0001, centerPrice - visibleSpan / 2);
      const maxPrice = centerPrice + visibleSpan / 2;
      const priceRange = maxPrice - minPrice;

      const clickedPrice =
        minPrice + ((mouseX - padLeft) / plotWidth) * priceRange;

      const sim = calculateSlippage(
        clickedPrice,
        aggregatedBids,
        aggregatedAsks,
        stats.bestBid,
        stats.bestAsk
      );

      if (sim) {
        setSelectedSimulation(sim);
        if (onLevelClick) onLevelClick(sim);
      } else {
        setSelectedSimulation(null);
      }
    },
    [aggregatedBids, aggregatedAsks, stats, zoom, onLevelClick]
  );

  // ── Render Component UI ───────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className={`relative w-full rounded-xl bg-slate-950 border border-slate-800 text-slate-100 p-4 shadow-xl select-none ${className}`}
      role="region"
      aria-label="Orderbook Depth Chart"
    >
      {/* Chart Header & Live Spread Metrics */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-semibold text-sm text-slate-200">
            <SlidersHorizontal size={16} className="text-teal-400" />
            <span>Orderbook Depth</span>
            <span className="text-xs text-slate-400 font-mono">
              ({baseSymbol}/{quoteSymbol})
            </span>
          </div>

          {stats.midPrice > 0 && (
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-xs font-mono">
              <span className="text-slate-400">Mid:</span>
              <span className="text-cyan-300 font-medium">
                {stats.midPrice.toFixed(2)}
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-400">Spread:</span>
              <span
                className={`font-medium ${
                  stats.spreadPercent < 0.5 ? "text-emerald-400" : "text-amber-400"
                }`}
              >
                {stats.spreadAbs.toFixed(4)} ({stats.spreadPercent.toFixed(2)}%)
              </span>
            </div>
          )}
        </div>

        {/* Aggregation & Zoom Controls */}
        {showControls && (
          <div className="flex items-center gap-2">
            {/* Price Step Aggregation Selector */}
            <div
              className="flex items-center bg-slate-900 rounded-lg p-0.5 border border-slate-800 text-xs font-mono"
              role="group"
              aria-label="Bucket aggregation step"
            >
              {[0.01, 0.1, 1.0].map((s) => (
                <button
                  key={s}
                  onClick={() => setStep(s)}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    step === s
                      ? "bg-teal-500/20 text-teal-300 font-medium border border-teal-500/40"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                  aria-pressed={step === s}
                  title={`Aggregate price levels in ${s} increments`}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Zoom Controls */}
            <div
              className="flex items-center bg-slate-900 rounded-lg p-0.5 border border-slate-800"
              role="group"
              aria-label="Chart zoom controls"
            >
              <button
                onClick={() => setZoom((z) => Math.min(5.0, Number((z * 1.25).toFixed(2))))}
                className="p-1 text-slate-400 hover:text-slate-100 transition-colors"
                title="Zoom in"
                aria-label="Zoom in"
              >
                <ZoomIn size={14} />
              </button>
              <button
                onClick={() => setZoom((z) => Math.max(0.5, Number((z / 1.25).toFixed(2))))}
                className="p-1 text-slate-400 hover:text-slate-100 transition-colors"
                title="Zoom out"
                aria-label="Zoom out"
              >
                <ZoomOut size={14} />
              </button>
              <button
                onClick={() => setZoom(1.0)}
                className="p-1 text-slate-400 hover:text-slate-100 transition-colors"
                title="Reset zoom"
                aria-label="Reset zoom"
              >
                <RotateCcw size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Canvas Viewport */}
      <div className="relative w-full mt-2" style={{ height }}>
        <canvas
          ref={canvasRef}
          width={1}
          height={1}
          aria-label="Interactive orderbook depth chart. Hover to inspect price, quantity, and cumulative depth; click a price to simulate a trade."
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleCanvasClick}
          className="w-full h-full cursor-crosshair block rounded-lg"
        />

        {hoverAnnouncement && (
          <div className="absolute left-3 top-3 rounded bg-slate-900/95 border border-slate-700 px-2 py-1 text-[11px] font-mono text-slate-100 pointer-events-none">
            {hoverAnnouncement}
          </div>
        )}

        {/* Empty State Fallback when orderbook has no liquidity */}
        {aggregatedBids.length === 0 && aggregatedAsks.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm rounded-lg text-slate-400 text-xs">
            <Info size={24} className="mb-2 text-slate-500" />
            <p className="font-medium">No orderbook liquidity available</p>
            <p className="text-slate-500 mt-1">Waiting for live Soroban contract events…</p>
          </div>
        )}
      </div>

      {/* Floating Simulated Slippage Drawer */}
      {selectedSimulation && (
        <div className="mt-3 p-3 rounded-lg bg-slate-900/90 border border-slate-700/80 backdrop-blur-md flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-full ${
                selectedSimulation.side === "buy"
                  ? "bg-rose-500/20 text-rose-300"
                  : "bg-emerald-500/20 text-emerald-300"
              }`}
            >
              {selectedSimulation.side === "buy" ? (
                <TrendingUp size={16} />
              ) : (
                <TrendingDown size={16} />
              )}
            </div>
            <div>
              <div className="font-semibold text-slate-200 flex items-center gap-2">
                <span>
                  Simulated {selectedSimulation.side === "buy" ? "Market Buy" : "Market Sell"}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                  Target: {selectedSimulation.targetPrice.toFixed(4)}
                </span>
              </div>
              <div className="text-slate-400 mt-0.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
                <span>
                  Sweep Depth:{" "}
                  <strong className="text-slate-200">
                    {selectedSimulation.requiredVolume.toLocaleString()} {baseSymbol}
                  </strong>
                </span>
                <span>
                  Total Cost:{" "}
                  <strong className="text-slate-200">
                    {selectedSimulation.totalQuoteCost.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}{" "}
                    {quoteSymbol}
                  </strong>
                </span>
                <span>
                  Avg Execution:{" "}
                  <strong className="text-cyan-300">
                    {selectedSimulation.avgExecutionPrice.toFixed(4)}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right font-mono">
              <span className="text-slate-400 block text-[10px]">Estimated Slippage</span>
              <span
                className={`text-sm font-bold ${
                  selectedSimulation.slippagePercent > 2.0
                    ? "text-rose-400"
                    : selectedSimulation.slippagePercent > 0.5
                    ? "text-amber-400"
                    : "text-emerald-400"
                }`}
              >
                +{selectedSimulation.slippagePercent.toFixed(2)}%
              </span>
            </div>

            <button
              onClick={() => setSelectedSimulation(null)}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
              aria-label="Dismiss slippage simulation"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Screen Reader Accessible Summary */}
      <div className="sr-only" aria-live="polite">
        Orderbook depth for {baseSymbol}/{quoteSymbol}. Best Bid: {stats.bestBid}, Best
        Ask: {stats.bestAsk}, Mid Market Price: {stats.midPrice}, Spread:{" "}
        {stats.spreadPercent.toFixed(2)} percent.
        {hoverAnnouncement}
      </div>
    </div>
  );
}
