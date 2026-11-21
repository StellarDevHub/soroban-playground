import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import SyntheticPositionRadar, {
  calculatePositionMetrics,
} from "../../components/SyntheticPositionRadar";

describe("SyntheticPositionRadar & Risk Engine", () => {
  describe("calculatePositionMetrics", () => {
    test("calculates safe status when collateral ratio is well above thresholds (HF >= 1.5)", () => {
      // Collateral = $300, Minted = 100 @ $1 -> Debt = $100 -> CR = 300%
      // HF = 300 / 120 = 2.5
      const metrics = calculatePositionMetrics({
        collateral: 300,
        minted: 100,
        assetPrice: 1,
        liquidationThreshold: 120,
        minCollateralRatio: 150,
      });

      expect(metrics.status).toBe("safe");
      expect(metrics.healthFactor).toBeCloseTo(2.5, 2);
      expect(metrics.isLiquidatable).toBe(false);
      expect(metrics.collateralRatio).toBeCloseTo(300, 1);
      expect(metrics.liquidationDropThresholdPct).toBeLessThan(-50);
    });

    test("calculates warning status when collateral ratio is between liquidation threshold and minimum ratio", () => {
      // Collateral = $135, Minted = 100 @ $1 -> Debt = $100 -> CR = 135%
      // HF = 135 / 120 = 1.125 (Between 1.0 and 1.25)
      const metrics = calculatePositionMetrics({
        collateral: 135,
        minted: 100,
        assetPrice: 1,
        liquidationThreshold: 120,
        minCollateralRatio: 150,
      });

      expect(metrics.status).toBe("warning");
      expect(metrics.healthFactor).toBeCloseTo(1.125, 2);
      expect(metrics.isLiquidatable).toBe(false);
    });

    test("calculates danger status when collateral ratio is at or below liquidation threshold (HF <= 1.0)", () => {
      // Collateral = $110, Minted = 100 @ $1 -> Debt = $100 -> CR = 110%
      // HF = 110 / 120 = 0.917 <= 1.0
      const metrics = calculatePositionMetrics({
        collateral: 110,
        minted: 100,
        assetPrice: 1,
        liquidationThreshold: 120,
        minCollateralRatio: 150,
      });

      expect(metrics.status).toBe("danger");
      expect(metrics.healthFactor).toBeLessThanOrEqual(1.0);
      expect(metrics.isLiquidatable).toBe(true);
    });

    test("simulates price shock correctly", () => {
      // Base CR = 200%. With -25% shock: Shocked Collateral = 150 -> Shocked CR = 150%
      const base = calculatePositionMetrics({
        collateral: 200,
        minted: 100,
        assetPrice: 1,
        shockPct: 0,
      });
      const shocked = calculatePositionMetrics({
        collateral: 200,
        minted: 100,
        assetPrice: 1,
        shockPct: -25,
      });

      expect(base.shockedCollateralRatio).toBe(200);
      expect(shocked.shockedCollateralRatio).toBe(150);
      expect(shocked.healthFactor).toBeLessThan(base.healthFactor);
    });

    test("handles zero debt or zero collateral safely without throwing", () => {
      const zeroDebt = calculatePositionMetrics({
        collateral: 100,
        minted: 0,
        assetPrice: 1,
      });
      expect(zeroDebt.status).toBe("danger");
      expect(zeroDebt.healthFactor).toBe(0);

      const zeroCol = calculatePositionMetrics({
        collateral: 0,
        minted: 10,
        assetPrice: 10,
      });
      expect(zeroCol.status).toBe("danger");
      expect(zeroCol.isLiquidatable).toBe(true);
    });
  });

  describe("Component Rendering & Interactions", () => {
    test("renders header, position title, and safe health badge", () => {
      render(
        <SyntheticPositionRadar
          positionId={1}
          assetSymbol="sUSD"
          collateral={300}
          minted={100}
          assetPrice={1}
        />,
      );

      expect(screen.getByText(/Position #1 · sUSD/i)).toBeInTheDocument();
      const badge = screen.getByTestId("health-factor-badge");
      expect(badge).toHaveAttribute("data-status", "safe");
      expect(badge).toHaveTextContent(/Safe Position/i);
    });

    test("renders radar SVG chart with concentric polygon rings and axis labels", () => {
      render(
        <SyntheticPositionRadar
          positionId={1}
          assetSymbol="sXLM"
          collateral={360}
          minted={200}
          assetPrice={1}
        />,
      );

      const svg = screen.getByTestId("radar-chart-svg");
      expect(svg).toBeInTheDocument();

      const polygon = screen.getByTestId("radar-polygon");
      expect(polygon).toBeInTheDocument();
      expect(polygon).toHaveAttribute("points");

      expect(screen.getByText("Collateral")).toBeInTheDocument();
      expect(screen.getByText("Health")).toBeInTheDocument();
      expect(screen.getByText("Margin")).toBeInTheDocument();
      expect(screen.getByText("Resilience")).toBeInTheDocument();
      expect(screen.getByText("Debt Safety")).toBeInTheDocument();
    });

    test("transitions badge and status from safe to danger when price shock triggers liquidation", () => {
      // Collateral = $140, Minted = 100 @ $1 -> CR = 140% (HF = 1.167, warning)
      render(
        <SyntheticPositionRadar
          positionId={2}
          assetSymbol="sBTC"
          collateral={140}
          minted={100}
          assetPrice={1}
        />,
      );

      const badge = screen.getByTestId("health-factor-badge");
      expect(badge).toHaveAttribute("data-status", "warning");
      expect(screen.queryByTestId("liquidation-warning-banner")).not.toBeInTheDocument();

      // Apply negative shock of -30%: Collateral drops to $98 -> CR = 98% < 120%
      const slider = screen.getByTestId("price-shock-slider");
      fireEvent.change(slider, { target: { value: "-30" } });

      // After shock, badge transitions to danger and liquidation warning appears
      expect(badge).toHaveAttribute("data-status", "danger");
      expect(screen.getByTestId("liquidation-warning-banner")).toBeInTheDocument();
      expect(screen.getByText(/Liquidation Imminent!/i)).toBeInTheDocument();
    });

    test("calls onShockChange callback when slider is adjusted", () => {
      const onShockChange = jest.fn();
      render(
        <SyntheticPositionRadar
          positionId={3}
          assetSymbol="sETH"
          collateral={400}
          minted={100}
          assetPrice={1}
          onShockChange={onShockChange}
        />,
      );

      const slider = screen.getByTestId("price-shock-slider");
      fireEvent.change(slider, { target: { value: "15" } });

      expect(onShockChange).toHaveBeenCalledWith(15);
      expect(screen.getByTestId("shock-value-display")).toHaveTextContent("+15%");
    });

    test("resets shock to 0% when reset button is clicked", () => {
      render(
        <SyntheticPositionRadar
          positionId={4}
          assetSymbol="sUSD"
          collateral={200}
          minted={100}
          assetPrice={1}
        />,
      );

      const slider = screen.getByTestId("price-shock-slider");
      fireEvent.change(slider, { target: { value: "-20" } });
      expect(screen.getByTestId("shock-value-display")).toHaveTextContent("-20%");

      const resetBtn = screen.getByRole("button", { name: /Reset \(0%\)/i });
      fireEvent.click(resetBtn);

      expect(screen.getByTestId("shock-value-display")).toHaveTextContent("0%");
    });
  });
});
