import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TestRunnerPanel } from "@/components/TestRunnerPanel";

describe("TestRunnerPanel", () => {
  it("renders panel header, metrics banner, and test counts with sample data", () => {
    render(<TestRunnerPanel />);

    expect(screen.getByRole("region", { name: /interactive test runner/i })).toBeInTheDocument();
    expect(screen.getByText("Pass Rate")).toBeInTheDocument();
    expect(screen.getByText("Total Latency")).toBeInTheDocument();
    expect(screen.getByText("Code Coverage")).toBeInTheDocument();

    // With sample data: 2 passed, 1 failed, 1 ignored (total 4)
    expect(screen.getByText("test_hello_world")).toBeInTheDocument();
    expect(screen.getByText("test_token_balance")).toBeInTheDocument();
    expect(screen.getByText("test_unauthorized_mint")).toBeInTheDocument();
  });

  it("filters tests by status button click", () => {
    render(<TestRunnerPanel />);

    // Click 'passed' filter
    const passedBtn = screen.getByRole("button", { name: /^passed/i });
    fireEvent.click(passedBtn);

    expect(screen.getByText("test_hello_world")).toBeInTheDocument();
    expect(screen.getByText("test_token_balance")).toBeInTheDocument();
    expect(screen.queryByText("test_unauthorized_mint")).not.toBeInTheDocument();

    // Click 'failed' filter
    const failedBtn = screen.getByRole("button", { name: /^failed/i });
    fireEvent.click(failedBtn);

    expect(screen.getByText("test_unauthorized_mint")).toBeInTheDocument();
    expect(screen.queryByText("test_hello_world")).not.toBeInTheDocument();
  });

  it("filters tests by search query", () => {
    render(<TestRunnerPanel />);

    const searchInput = screen.getByPlaceholderText(/filter test cases/i);
    fireEvent.change(searchInput, { target: { value: "hello" } });

    expect(screen.getByText("test_hello_world")).toBeInTheDocument();
    expect(screen.queryByText("test_token_balance")).not.toBeInTheDocument();
    expect(screen.queryByText("test_unauthorized_mint")).not.toBeInTheDocument();
  });

  it("displays assertion diff and panic details for failed test", () => {
    render(<TestRunnerPanel />);

    // The failed test should display assertion details
    expect(screen.getByText(/assertion failure & panic output/i)).toBeInTheDocument();
    expect(screen.getByText(/left \(actual\)/i)).toBeInTheDocument();
    expect(screen.getByText(/right \(expected\)/i)).toBeInTheDocument();
    expect(screen.getByText("401")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
  });

  it("switches to Code Coverage tab and renders coverage breakdown table", () => {
    render(<TestRunnerPanel />);

    const coverageTab = screen.getByRole("tab", { name: /code coverage/i });
    fireEvent.click(coverageTab);

    expect(screen.getByText(/line-level test coverage/i)).toBeInTheDocument();
    expect(screen.getByText("src/lib.rs")).toBeInTheDocument();
    expect(screen.getByText("src/token.rs")).toBeInTheDocument();
  });

  it("switches to Raw Stream tab and renders stream contents", () => {
    render(<TestRunnerPanel />);

    const rawTab = screen.getByRole("tab", { name: /raw stream/i });
    fireEvent.click(rawTab);

    expect(screen.getByText(/copy stream/i)).toBeInTheDocument();
  });

  it("calls onRunTests when Run Tests button is clicked", () => {
    const onRunTests = jest.fn();
    render(<TestRunnerPanel onRunTests={onRunTests} />);

    const runBtn = screen.getByTestId("run-tests-btn");
    fireEvent.click(runBtn);

    expect(onRunTests).toHaveBeenCalledTimes(1);
  });

  it("calls onSelectLine when line badge is clicked", () => {
    const onSelectLine = jest.fn();
    render(<TestRunnerPanel onSelectLine={onSelectLine} />);

    // Click on the line badge for the failed test: src/lib.rs:48
    const lineBadge = screen.getByRole("button", { name: /src\/lib\.rs:48/i });
    fireEvent.click(lineBadge);

    expect(onSelectLine).toHaveBeenCalledWith(48);
  });

  it("applies decorations to Monaco editor instance and cleans up on unmount", () => {
    const mockEditor = {
      deltaDecorations: jest.fn().mockReturnValue(["dec-1", "dec-2"]),
    };

    const { unmount } = render(<TestRunnerPanel editorInstance={mockEditor} />);

    expect(mockEditor.deltaDecorations).toHaveBeenCalled();

    unmount();
    // Verify cleanup
    expect(mockEditor.deltaDecorations).toHaveBeenLastCalledWith(["dec-1", "dec-2"], []);
  });
});
