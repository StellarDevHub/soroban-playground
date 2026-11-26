import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import TeleportSimulator from "../TeleportSimulator";

describe("TeleportSimulator", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("renders the stepper, completes a happy path, and displays an injected failure", async () => {
    const { unmount } = render(<TeleportSimulator />);
    expect(screen.getByRole("list", { name: /bridge transaction progress/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /cross-chain teleport simulator/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /start transfer/i }));
    for (let tick = 0; tick < 40; tick += 1) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(250);
      });
    }
    expect(screen.getByRole("status")).toHaveTextContent("Bridge transfer completed.");
    unmount();

    render(<TeleportSimulator />);
    fireEvent.change(screen.getByLabelText(/failure scenario/i), { target: { value: "signature-expired" } });
    fireEvent.click(screen.getByRole("button", { name: /start transfer/i }));
    for (let tick = 0; tick < 36; tick += 1) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(250);
      });
    }
    expect(screen.getByRole("status")).toHaveTextContent(/signature TTL elapsed/i);
    expect(screen.getByText("failed signature expired", { exact: true })).toBeInTheDocument();
  });
});