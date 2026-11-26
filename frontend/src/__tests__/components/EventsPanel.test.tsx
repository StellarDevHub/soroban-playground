import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { EventsPanel } from "@/components/EventsPanel";

const mockUseEventStream = jest.fn();

jest.mock("@/hooks/useEventStream", () => ({
  useEventStream: (...args: unknown[]) => mockUseEventStream(...args),
}));

function makeEvent(
  id: string,
  contractId: string,
  eventType: string,
  ledger: number,
  topics: string[] = [],
) {
  return {
    id,
    type: "event" as const,
    event_type: eventType,
    contract_id: contractId,
    ledger,
    ledger_closed_at: "2026-01-01T00:00:00.000Z",
    data: JSON.stringify({ id }),
    topics,
  };
}

describe("EventsPanel", () => {
  beforeEach(() => {
    mockUseEventStream.mockReturnValue({
      events: [
        makeEvent("evt-1", "CC1234567890ABCDEF", "transfer", 100, [
          "Transfer",
        ]),
      ],
      status: "connected",
      droppedCount: 0,
      clearEvents: jest.fn(),
      reconnect: jest.fn(),
    });
  });

  it("renders live events title and event badge", () => {
    render(<EventsPanel wsUrl="ws://localhost:3001/ws/events" />);
    expect(screen.getByText("Live Events")).toBeInTheDocument();
    expect(screen.getByText("transfer")).toBeInTheDocument();
  });

  it("filters by contract ID, topic symbol, and ledger range", () => {
    mockUseEventStream.mockReturnValue({
      events: [
        makeEvent("evt-match", "CCABC123MATCH", "only-match", 110, [
          "Transfer",
        ]),
        makeEvent("evt-contract", "CCOTHER123456", "wrong-contract", 110, [
          "Transfer",
        ]),
        makeEvent("evt-topic", "CCABC123MATCH", "wrong-topic", 110, ["Mint"]),
        makeEvent("evt-ledger", "CCABC123MATCH", "wrong-ledger", 130, [
          "Transfer",
        ]),
      ],
      status: "connected",
      droppedCount: 0,
      clearEvents: jest.fn(),
      reconnect: jest.fn(),
    });

    render(<EventsPanel />);
    fireEvent.change(screen.getByLabelText("Filter by contract ID"), {
      target: { value: "CCABC123" },
    });
    fireEvent.change(screen.getByLabelText("Filter by event topic"), {
      target: { value: "Transfer" },
    });
    fireEvent.change(screen.getByLabelText("Filter from ledger"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByLabelText("Filter to ledger"), {
      target: { value: "120" },
    });

    expect(screen.getByText("only-match")).toBeInTheDocument();
    expect(screen.queryByText("wrong-contract")).not.toBeInTheDocument();
    expect(screen.queryByText("wrong-topic")).not.toBeInTheDocument();
    expect(screen.queryByText("wrong-ledger")).not.toBeInTheDocument();
  });

  it("keeps 10,000 events virtualized within a sub-5ms render budget", () => {
    mockUseEventStream.mockReturnValue({
      events: Array.from({ length: 10_000 }, (_, index) =>
        makeEvent(`evt-${index}`, "CC1234567890ABCDEF", "transfer", index),
      ),
      status: "connected",
      droppedCount: 0,
      clearEvents: jest.fn(),
      reconnect: jest.fn(),
    });
    const renderDurations: number[] = [];

    render(
      <React.Profiler
        id="event-list"
        onRender={(_, __, actualDuration) =>
          renderDurations.push(actualDuration)
        }
      >
        <EventsPanel />
      </React.Profiler>,
    );

    const renderedRows = screen.getAllByText("transfer");
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(100);
    expect(renderDurations[0]).toBeLessThan(5);
  });
});
