import { render, screen, fireEvent } from "@testing-library/react";
import SyntheticPositionRadar, {
  calculateDropToLiquidation,
  calculateHealthFactor,
  calculateLiquidationPrice,
  calculateRadarAxes,
  getHealthStatus,
  type PositionData,
} from "../../components/SyntheticPositionRadar";

let capturedRadarProps: {
  data?: { datasets?: Array<{ borderColor?: string }> };
} | null = null;

jest.mock("react-chartjs-2", () => ({
  Radar: (props: { data?: { datasets?: Array<{ borderColor?: string }> } }) => {
    capturedRadarProps = props;
    return (
      <div data-testid="mocked-radar-chart">
        <span data-testid="radar-datasets-count">
          {props.data?.datasets?.length}
        </span>
        <span data-testid="radar-border-color">
          {props.data?.datasets?.[0]?.borderColor}
        </span>
      </div>
    );
  },
}));

describe("SyntheticPositionRadar & Health Factor Math", () => {
  beforeEach(() => {
    capturedRadarProps = null;
    jest.clearAllMocks();
  });

  describe("Health Factor Math Calculations", () => {
    test("calculates correct health factor for safe, warning and liquidatable positions", () => {
      // 180% ratio / 120% threshold = 1.5 HF (Safe)
      expect(calculateHealthFactor(360, 200, 120)).toBeCloseTo(1.5, 6);

      // 144% ratio / 120% threshold = 1.2 HF (Warning)
      expect(calculateHealthFactor(288, 200, 120)).toBeCloseTo(1.2, 6);

      // 120% ratio / 120% threshold = 1.0 HF (Exact liquidation boundary)
      expect(calculateHealthFactor(240, 200, 120)).toBeCloseTo(1.0, 6);

      // 108% ratio / 120% threshold = 0.9 HF (Liquidatable Danger)
      expect(calculateHealthFactor(216, 200, 120)).toBeCloseTo(0.9, 6);
    });

    test("handles edge cases gracefully", () => {
      expect(calculateHealthFactor(100, 0, 120)).toBe(999);
      expect(calculateHealthFactor(0, 100, 120)).toBe(0);
    });

    test("calculates exact liquidation price", () => {
      // 10 units collateral, 2 units minted at $100 price = $200 debt.
      // Liquidation threshold 120% requires $240 collateral value.
      // Liquidation price per unit = $240 / 10 = $24.
      expect(calculateLiquidationPrice(10, 2, 100, 120)).toBeCloseTo(24, 6);
    });

    test("calculates exact percentage drop before liquidation occurs", () => {
      // Current ratio 160%, threshold 120% -> (160 - 120) / 160 = 25% drop
      expect(calculateDropToLiquidation(160, 120)).toBeCloseTo(25, 6);

      // At or below threshold -> 0% drop remaining
      expect(calculateDropToLiquidation(120, 120)).toBe(0);
      expect(calculateDropToLiquidation(100, 120)).toBe(0);
    });

    test("computes bounded radar axis scores (0 to 100)", () => {
      const safeScores = calculateRadarAxes(500, 100, 120, 150, 25);
      safeScores.forEach((score) => {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      });

      const dangerScores = calculateRadarAxes(110, 100, 120, 150, 25);
      dangerScores.forEach((score) => {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      });
      // Danger scores should be significantly lower than safe scores
      expect(dangerScores[0]).toBe(0); // Collateral buffer exhausted
      expect(dangerScores[1]).toBe(0); // Health factor score 0
    });
  });

  describe("Color Transitions as Health Factor approaches 1.0", () => {
    test("returns Green (Safe) status and styling when Health Factor >= 1.5", () => {
      const status = getHealthStatus(1.5);
      expect(status.status).toBe("safe");
      expect(status.label).toBe("Safe");
      expect(status.hexColor).toBe("#10b981");
      expect(status.badgeText).toContain("emerald");

      const highStatus = getHealthStatus(2.4);
      expect(highStatus.status).toBe("safe");
      expect(highStatus.hexColor).toBe("#10b981");
    });

    test("transitions to Amber (Warning) as Health Factor enters warning zone (1.0 <= HF < 1.5)", () => {
      const statusAt14 = getHealthStatus(1.4);
      expect(statusAt14.status).toBe("warning");
      expect(statusAt14.label).toBe("Warning");
      expect(statusAt14.hexColor).toBe("#f59e0b");
      expect(statusAt14.badgeText).toContain("amber");

      const statusAtBoundary = getHealthStatus(1.0);
      expect(statusAtBoundary.status).toBe("warning");
      expect(statusAtBoundary.hexColor).toBe("#f59e0b");
    });

    test("transitions to Red (Danger) as Health Factor drops below 1.0", () => {
      const statusNearLiq = getHealthStatus(0.99);
      expect(statusNearLiq.status).toBe("danger");
      expect(statusNearLiq.label).toBe("Danger");
      expect(statusNearLiq.hexColor).toBe("#f43f5e");
      expect(statusNearLiq.badgeText).toContain("rose");

      const deepDangerStatus = getHealthStatus(0.75);
      expect(deepDangerStatus.status).toBe("danger");
      expect(deepDangerStatus.hexColor).toBe("#f43f5e");
    });
  });

  describe("SyntheticPositionRadar UI Component & Price Shock Slider", () => {
    const mockPosition: PositionData = {
      id: 1,
      assetSymbol: "sETH",
      collateral: 360, // $360 collateral
      minted: 2, // 2 units
      assetPrice: 100, // $100 -> $200 debt. Ratio = 180%, HF = 1.5 (Safe)
      liquidationThreshold: 120,
      minCollateralRatio: 150,
      volatilityPct: 25,
    };

    test("renders header, health factor badge and radar chart", () => {
      render(<SyntheticPositionRadar position={mockPosition} />);

      expect(
        screen.getByRole("heading", { name: /Position Health Factor Radar/i }),
      ).toBeInTheDocument();

      const badge = screen.getByTestId("health-factor-badge");
      expect(badge).toHaveTextContent("Safe");
      expect(badge).toHaveTextContent("1.50 HF");
      expect(screen.getByTestId("mocked-radar-chart")).toBeInTheDocument();
    });

    test("chart border color is green (#10b981) initially for safe position", () => {
      render(<SyntheticPositionRadar position={mockPosition} />);

      expect(capturedRadarProps.data.datasets[0].borderColor).toBe("#10b981");
    });

    test("simulated price shock slider updates health factor and transitions chart color", () => {
      render(<SyntheticPositionRadar position={mockPosition} />);

      const slider = screen.getByLabelText(/Simulated Collateral Price Shock/i);

      // Shock by -25%:
      // Collateral drops from 360 to 360 * 0.75 = 270.
      // Ratio = 270 / 200 = 135%. HF = 135 / 120 = 1.125 (Warning)
      fireEvent.change(slider, { target: { value: "-25" } });

      const badge = screen.getByTestId("health-factor-badge");
      expect(badge).toHaveTextContent("Warning");
      expect(badge).toHaveTextContent("1.13 HF");
      expect(capturedRadarProps.data.datasets[0].borderColor).toBe("#f59e0b");

      // Shock by -40%:
      // Collateral drops to 360 * 0.60 = 216.
      // Ratio = 216 / 200 = 108%. HF = 108 / 120 = 0.90 (Danger / Liquidated)
      fireEvent.change(slider, { target: { value: "-40" } });

      expect(badge).toHaveTextContent("Danger");
      expect(badge).toHaveTextContent("0.90 HF");
      expect(capturedRadarProps.data.datasets[0].borderColor).toBe("#f43f5e");
      expect(
        screen.getByText(/Instant Liquidation Threshold Breached!/i),
      ).toBeInTheDocument();
    });

    test("quick shock preset buttons trigger shock changes", () => {
      render(<SyntheticPositionRadar position={mockPosition} />);

      const shockButton = screen.getByRole("button", { name: "-50%" });
      fireEvent.click(shockButton);

      const badge = screen.getByTestId("health-factor-badge");
      expect(badge).toHaveTextContent("Danger");
      expect(screen.getByText(/Instant Liquidation Threshold Breached!/i)).toBeInTheDocument();

      const resetButton = screen.getByRole("button", { name: "Reset" });
      fireEvent.click(resetButton);

      expect(badge).toHaveTextContent("Safe");
    });

    test("switches between multiple positions", () => {
      const positions: PositionData[] = [
        mockPosition,
        {
          id: 2,
          assetSymbol: "sBTC",
          collateral: 240, // $240 collateral for $200 debt -> ratio 120%, HF 1.0 (Warning/Boundary)
          minted: 2,
          assetPrice: 100,
          liquidationThreshold: 120,
        },
      ];

      render(<SyntheticPositionRadar positions={positions} />);

      const pos2Button = screen.getByRole("button", { name: "#2 sBTC" });
      fireEvent.click(pos2Button);

      const badge = screen.getByTestId("health-factor-badge");
      expect(badge).toHaveTextContent("Warning");
      expect(badge).toHaveTextContent("1.00 HF");
    });
  });
});
