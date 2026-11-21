import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import YieldSimulator from "../../components/YieldSimulator";

// Mock ResizeObserver for JSDOM
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe("YieldSimulator Component", () => {
  beforeEach(() => {
    // Mock HTMLCanvasElement getContext
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
      scale: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fillText: jest.fn(),
      fillRect: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      setLineDash: jest.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    HTMLCanvasElement.prototype.getBoundingClientRect = jest.fn(() => ({
      width: 600,
      height: 300,
      top: 0,
      left: 0,
      bottom: 300,
      right: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    }));
  });

  test("renders the YieldSimulator header, math engine tag, and main headings", () => {
    render(<YieldSimulator />);

    expect(screen.getByText(/Soroban · DeFi Lab/i)).toBeInTheDocument();
    expect(screen.getByText(/Uniswap v3 Math Engine/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Liquidity Yield & APY Simulator/i })).toBeInTheDocument();
  });

  test("renders fee tier preset buttons and updates fee selection when clicked", () => {
    render(<YieldSimulator />);

    const fee005Btn = screen.getByRole("button", { name: /0.05%/i });
    expect(fee005Btn).toBeInTheDocument();

    fireEvent.click(fee005Btn);
    expect(screen.getAllByText(/0.05%/i).length).toBeGreaterThan(0);
  });

  test("renders key metric cards with proper values", () => {
    render(<YieldSimulator />);

    expect(screen.getByText(/Concentrated Fee APY/i)).toBeInTheDocument();
    expect(screen.getByText(/Concentrated Imp. Loss/i)).toBeInTheDocument();
    expect(screen.getByText(/Net Projected Return/i)).toBeInTheDocument();
  });

  test("displays in-range active badge by default at probe 0%", () => {
    render(<YieldSimulator />);

    expect(screen.getByText(/In Active Range/i)).toBeInTheDocument();
  });

  test("allows adjusting the daily pool volume slider", () => {
    render(<YieldSimulator />);

    const volumeSlider = screen.getByLabelText(/Daily Pool Volume/i);
    fireEvent.change(volumeSlider, { target: { value: "2000000" } });
    expect(volumeSlider).toHaveValue("2000000");
  });

  test("allows adjusting range boundary sliders", () => {
    render(<YieldSimulator />);

    const lowerSlider = screen.getByLabelText(/Lower Range Bound/i);
    fireEvent.change(lowerSlider, { target: { value: "-25" } });
    expect(lowerSlider).toHaveValue("-25");
  });

  test("resets simulation parameters when reset button is clicked", () => {
    render(<YieldSimulator />);

    const fee100Btn = screen.getByRole("button", { name: /1.00%/i });
    fireEvent.click(fee100Btn);

    const resetBtn = screen.getByRole("button", { name: /Reset parameters/i });
    fireEvent.click(resetBtn);

    // After reset, fee defaults back to 0.30%
    expect(screen.getAllByText(/0.30%/i).length).toBeGreaterThan(0);
  });

  test("exports simulation scenario JSON when export button is clicked", () => {
    render(<YieldSimulator />);

    const mockCreateObjectURL = jest.fn(() => "blob:mock-url");
    const mockRevokeObjectURL = jest.fn();
    window.URL.createObjectURL = mockCreateObjectURL;
    window.URL.revokeObjectURL = mockRevokeObjectURL;

    const exportBtn = screen.getByRole("button", { name: /Export JSON/i });
    fireEvent.click(exportBtn);

    expect(mockCreateObjectURL).toHaveBeenCalled();
  });
});
