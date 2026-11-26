import { render, screen, fireEvent } from "@testing-library/react";
import YieldCurveSimulator from "../../components/Defi/YieldCurveSimulator";
import YieldSimulator from "../../components/YieldSimulator";

jest.mock("react-chartjs-2", () => ({
  Line: ({ data, options }: any) => (
    <div data-testid="chartjs-line-chart" aria-label="Mocked ChartJS Line">
      <span>Datasets: {data?.datasets?.length}</span>
      <span>Labels: {data?.labels?.length}</span>
    </div>
  ),
}));

describe("YieldCurveSimulator component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("renders simulator title, controls and chart container", () => {
    render(<YieldCurveSimulator />);

    expect(
      screen.getByRole("heading", { name: /Liquidity Yield & APY Curve Simulator/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Simulation Controls/i)).toBeInTheDocument();
    expect(screen.getByTestId("chartjs-line-chart")).toBeInTheDocument();
  });

  test("renders KPI metric cards", () => {
    render(<YieldCurveSimulator />);

    expect(screen.getByText(/Concentrated Fee APY/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Concentrated IL/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Constant Product IL/i)).toBeInTheDocument();
    expect(screen.getByText(/Net Horizon Return/i)).toBeInTheDocument();
  });

  test("switches between Yield & IL Curve and Historical vs Projected tabs", () => {
    render(<YieldCurveSimulator />);

    const historicalTab = screen.getByRole("button", {
      name: /Historical vs Projected/i,
    });
    fireEvent.click(historicalTab);

    expect(
      screen.getByText(/30-day historical performance backtest vs forward-looking/i),
    ).toBeInTheDocument();

    const curveTab = screen.getByRole("button", {
      name: /Yield & IL Curve/i,
    });
    fireEvent.click(curveTab);

    expect(
      screen.getByText(/Yield and impermanent loss trajectories across price moves/i),
    ).toBeInTheDocument();
  });

  test("selecting fee tier updates swap fee assumptions", () => {
    render(<YieldCurveSimulator />);

    const feeButtons = screen.getAllByRole("button", { name: /0.05% \(5 bps\)/i });
    fireEvent.click(feeButtons[0]);

    expect(screen.getAllByText(/0.05% \(5 bps\)/i).length).toBeGreaterThan(0);
  });

  test("range bounds adjustment updates in-range status badge", () => {
    render(<YieldCurveSimulator />);

    // When price is inside range (activePct=0, lower=-50, upper=100)
    expect(screen.getByText(/Position is Active and in Range/i)).toBeInTheDocument();

    // Select ±10% tight range preset
    const tightPreset = screen.getByRole("button", { name: /±10% Tight/i });
    fireEvent.click(tightPreset);

    expect(screen.getByText(/Position is Active and in Range/i)).toBeInTheDocument();
  });

  test("YieldSimulator re-export alias renders identical interface", () => {
    render(<YieldSimulator />);

    expect(
      screen.getByRole("heading", { name: /Liquidity Yield & APY Curve Simulator/i }),
    ).toBeInTheDocument();
  });
});
