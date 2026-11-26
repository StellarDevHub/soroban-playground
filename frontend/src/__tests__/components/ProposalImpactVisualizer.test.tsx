import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import ProposalImpactVisualizer from "@/components/Gov/ProposalImpactVisualizer";
import { INITIAL_GOVERNANCE_PROPOSALS } from "@/lib/gov/mockProposals";

describe("ProposalImpactVisualizer Component", () => {
  it("renders visualizer title, stats banner, and proposal list", () => {
    render(<ProposalImpactVisualizer />);

    expect(
      screen.getByTestId("proposal-impact-visualizer"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Governance Proposal Impact Visualizer"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /PIP-14/ })).toBeInTheDocument();
  });

  it("filters proposals by status, including executed proposals", () => {
    render(<ProposalImpactVisualizer />);

    const passedTab = screen.getByRole("button", { name: "Passed" });
    fireEvent.click(passedTab);

    // PIP-16 is Passed
    expect(screen.getByRole("button", { name: /PIP-16/ })).toBeInTheDocument();
    // PIP-14 is Active, should not be in the list
    expect(
      screen.queryByText("Reduce AMM Swap Protocol Fee from 30 bps to 20 bps"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Executed" }));
    expect(screen.getByRole("button", { name: /PIP-12/ })).toBeInTheDocument();
  });

  it("selects proposal and renders quorum and approval meters", () => {
    render(<ProposalImpactVisualizer />);

    // By default, PIP-14 is selected
    expect(screen.getByText("Quorum Threshold")).toBeInTheDocument();
    expect(screen.getByText("Approval Ratio")).toBeInTheDocument();
    expect(
      screen.getByText(/Forecasted Execution Impact & Ledger State Diffs/i),
    ).toBeInTheDocument();
  });

  it("renders quadratic voting curve simulator for QV-enabled proposals", () => {
    render(<ProposalImpactVisualizer />);

    expect(
      screen.getByText(/Quadratic Voting Cost Curve & Simulator/i),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Quadratic credit allocation slider/i),
    ).toBeInTheDocument();

    const slider = screen.getByLabelText(/Quadratic credit allocation slider/i);
    fireEvent.change(slider, { target: { value: "144" } });

    // sqrt(144) = 12 votes
    expect(screen.getByText("12 Votes")).toBeInTheDocument();
  });

  it("renders prospective state diff table with critical keys", () => {
    render(<ProposalImpactVisualizer />);

    expect(screen.getByText("fee_rate_bps")).toBeInTheDocument();
    expect(screen.getByText("fee_recipient")).toBeInTheDocument();
    expect(screen.getAllByText("Critical").length).toBeGreaterThan(0);
  });

  it("allows casting a single vote with confirmation", async () => {
    const onVoteSubmitMock = jest.fn();
    render(<ProposalImpactVisualizer onVoteSubmit={onVoteSubmitMock} />);

    // Click 'Vote Against'
    const againstBtn = screen.getByRole("button", { name: /Vote Against/i });
    fireEvent.click(againstBtn);

    // Submit vote
    const submitBtn = screen.getByRole("button", { name: /Authorize Vote/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onVoteSubmitMock).toHaveBeenCalledWith("PIP-14", "Against", 100);
      expect(screen.getByText(/Vote callback completed/i)).toBeInTheDocument();
    });
  });

  it("opens batch voting modal and submits multi-proposal votes", async () => {
    const onBatchVoteMock = jest.fn();
    render(<ProposalImpactVisualizer onBatchVoteSubmit={onBatchVoteMock} />);

    const batchBtn = screen.getByRole("button", { name: /Batch Voting/i });
    fireEvent.click(batchBtn);

    expect(screen.getByText("Batch Proposal Voting")).toBeInTheDocument();

    const submitBatchBtn = screen.getByRole("button", {
      name: /Submit Batch Votes/i,
    });
    const credits = screen.getByLabelText("Credits for PIP-14");
    fireEvent.change(credits, { target: { value: "75" } });
    fireEvent.click(submitBatchBtn);

    await waitFor(() => {
      expect(onBatchVoteMock).toHaveBeenCalled();
      expect(onBatchVoteMock).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ proposalId: "PIP-14", credits: 75 }),
        ]),
      );
      expect(screen.getByText(/Batch callback completed/i)).toBeInTheDocument();
    });
  });

  it("clearly labels a vote without a host callback as a local demo", async () => {
    render(<ProposalImpactVisualizer />);
    fireEvent.click(screen.getByRole("button", { name: /Authorize Vote/i }));
    await waitFor(() => {
      expect(
        screen.getByText(
          /Demo vote recorded locally. No on-chain transaction was submitted./i,
        ),
      ).toBeInTheDocument();
    });
  });

  it("renders SVG circular gauge displaying current votes relative to minimum quorum floor", () => {
    render(<ProposalImpactVisualizer proposals={INITIAL_GOVERNANCE_PROPOSALS} />);

    const gauge = screen.getByTestId("quorum-circular-gauge");
    expect(gauge).toBeInTheDocument();
    expect(gauge).toHaveAttribute("role", "progressbar");
    expect(gauge).toHaveAttribute("aria-valuenow", "74.5");
    expect(gauge).toHaveAttribute("aria-valuemin", "0");
    expect(gauge).toHaveAttribute("aria-valuemax", "100");

    // Quorum metrics relative to floor
    expect(screen.getByText("74.5%")).toBeInTheDocument();
    expect(screen.getByText("Current Votes:")).toBeInTheDocument();
    expect(screen.getByText("74,500 Tokens")).toBeInTheDocument();
    expect(screen.getByText("Minimum Quorum Floor:")).toBeInTheDocument();
    expect(screen.getByText("100,000 Tokens")).toBeInTheDocument();
    expect(screen.getByText(/25,500 tokens needed/i)).toBeInTheDocument();
  });

  it("displays simulated treasury balance impact if proposal passes", () => {
    render(<ProposalImpactVisualizer proposals={INITIAL_GOVERNANCE_PROPOSALS} />);

    expect(screen.getByTestId("treasury-impact-section")).toBeInTheDocument();
    expect(
      screen.getByText("Simulated Treasury Balance Impact"),
    ).toBeInTheDocument();

    // Select PIP-11 (Ecosystem Grant Treasury Allocation)
    const defeatedTab = screen.getByRole("button", { name: "Defeated" });
    fireEvent.click(defeatedTab);
    const pip11Btn = screen.getByRole("button", { name: /PIP-11/ });
    fireEvent.click(pip11Btn);

    // PIP-11 state diff shows 25,000,000 -> 24,500,000 XLM (-500,000 XLM drawdown)
    expect(screen.getByText("Reserve Drawdown")).toBeInTheDocument();
    expect(screen.getByText("25,000,000 XLM")).toBeInTheDocument();
    expect(screen.getByText(/-500,000 XLM/i)).toBeInTheDocument();
    expect(screen.getByText("24,500,000 XLM")).toBeInTheDocument();
    expect(
      screen.getByText(/Disburses 500,000 XLM from community treasury upon execution/i),
    ).toBeInTheDocument();
  });

  it("updates vote tallies and circular quorum gauge in real time from live contract events", async () => {
    const onVoteEventMock = jest.fn();

    const liveVoteEvent = {
      id: "live-vote-evt-1",
      type: "event" as const,
      event_type: "voted",
      contract_id: "CA3D5KRYMCMCZKPOJG7PYHHWNGIBRE7VAISD764NF7LADW43STODGRSX",
      ledger: 5431300,
      ledger_closed_at: new Date().toISOString(),
      data: JSON.stringify({
        proposalId: "PIP-14",
        choice: "For",
        credits: 30000,
        vote_weight: 30000,
        is_for: true,
      }),
    };

    render(
      <ProposalImpactVisualizer
        proposals={INITIAL_GOVERNANCE_PROPOSALS}
        liveEvents={[liveVoteEvent]}
        onVoteEvent={onVoteEventMock}
      />,
    );

    await waitFor(() => {
      expect(onVoteEventMock).toHaveBeenCalledWith(liveVoteEvent);
    });

    // PIP-14 had 74,500 tokens voted with a 100,000 quorum threshold.
    // +30,000 tokens brings total to 104,500 tokens, meeting and exceeding the quorum floor!
    await waitFor(() => {
      const gauge = screen.getByTestId("quorum-circular-gauge");
      expect(gauge).toHaveAttribute("aria-valuenow", "100");
      expect(screen.getByText("104,500 Tokens")).toBeInTheDocument();
      expect(screen.getByText("Quorum Reached")).toBeInTheDocument();
      expect(screen.getByText(/Floor Met \(\+4,500\)/i)).toBeInTheDocument();
    });

    // Check live stream indicator in header
    expect(screen.getByTestId("live-event-status")).toHaveTextContent(/Live/i);
  });
});
