import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TtlBadge from "../../components/storage/TtlBadge";
import BumpTtlModal from "../../components/storage/BumpTtlModal";
import StorageBrowserPage from "../../app/storage-browser/page";
import type { TtlStatus, StorageBrowserEntry } from "../../types/storageBrowser";

// ─── TtlBadge Tests ──────────────────────────────────────────────────────────

describe("TtlBadge Component", () => {
  it("renders No TTL fallback when ttl is null", () => {
    render(<TtlBadge ttl={null} />);
    expect(screen.getByText("No TTL")).toBeInTheDocument();
  });

  it("renders healthy TTL with ledgers countdown and estimated days", () => {
    const ttl: TtlStatus = {
      status: "healthy",
      currentLedger: 1000000,
      liveUntilLedgerSeq: 1050000,
      ledgersRemaining: 50000,
      estimatedTimeRemaining: "2.9d",
      isExpiring: false,
      isCritical: false,
      canBump: true,
    };

    render(<TtlBadge ttl={ttl} />);
    expect(screen.getByText(/50,000 ledgers/)).toBeInTheDocument();
    expect(screen.getByText(/\(2\.9d\)/)).toBeInTheDocument();
    expect(screen.getByText(/Expires #1,050,000/)).toBeInTheDocument();
  });

  it("renders expiring warning badge with countdown", () => {
    const ttl: TtlStatus = {
      status: "expiring",
      currentLedger: 1000000,
      liveUntilLedgerSeq: 1010000,
      ledgersRemaining: 10000,
      estimatedTimeRemaining: "13.9h",
      isExpiring: true,
      isCritical: false,
      canBump: true,
    };

    render(<TtlBadge ttl={ttl} />);
    expect(screen.getByText(/10,000 ledgers/)).toBeInTheDocument();
    expect(screen.getByText(/\(13\.9h\)/)).toBeInTheDocument();
  });

  it("renders critical alert badge for entries expiring very soon", () => {
    const ttl: TtlStatus = {
      status: "critical",
      currentLedger: 1000000,
      liveUntilLedgerSeq: 1001200,
      ledgersRemaining: 1200,
      estimatedTimeRemaining: "1.7h",
      isExpiring: true,
      isCritical: true,
      canBump: true,
    };

    render(<TtlBadge ttl={ttl} />);
    expect(screen.getByText(/1,200 ledgers/)).toBeInTheDocument();
    expect(screen.getByText(/\(1\.7h\)/)).toBeInTheDocument();
  });

  it("renders archived badge when entry has expired", () => {
    const ttl: TtlStatus = {
      status: "archived",
      currentLedger: 1000000,
      liveUntilLedgerSeq: 995000,
      ledgersRemaining: -5000,
      estimatedTimeRemaining: "Archived",
      isExpiring: false,
      isCritical: false,
      canBump: false,
    };

    render(<TtlBadge ttl={ttl} />);
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText(/Expired #995,000/)).toBeInTheDocument();
  });
});

// ─── BumpTtlModal Tests ──────────────────────────────────────────────────────

describe("BumpTtlModal Component", () => {
  const mockEntry: StorageBrowserEntry = {
    id: "entry-1",
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    durability: "persistent",
    keyRaw: "AAAAEQAAAAEAAAACAAAADwAAAARmcm9tAAAAEgAAAAAAAAAAFZ8473AVcvAsFNAflddud7/vamD9+DD9s8N33tAT7OEAAAAPAAAAB3NwZW5kZXIAAAAAEgAAAAAAAAAARpEAM8k6TU2H5MghsV+xJfolziKdjEYYJeFP8T5Tzjg=",
    keyDecoded: {
      type: "Struct(AllowanceKey)",
      displayValue: "AllowanceKey { from: G..., spender: G... }",
      nativeValue: { from: "G...", spender: "G..." },
      rawXdr: "AAAAEQAAAA==",
    },
    valRaw: "AAAAAwAAAAE=",
    valDecoded: {
      type: "Struct(AllowanceData)",
      displayValue: "{ amount: 1500000000 }",
      nativeValue: { amount: 1500000000 },
      rawXdr: "AAAAAwAAAAE=",
    },
    ttl: {
      status: "expiring",
      currentLedger: 1000000,
      liveUntilLedgerSeq: 1001850,
      ledgersRemaining: 1850,
      estimatedTimeRemaining: "2.6h",
      isExpiring: true,
      isCritical: false,
      canBump: true,
    },
    diff: "changed",
  };

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <BumpTtlModal
        isOpen={false}
        onClose={jest.fn()}
        entry={mockEntry}
        currentLedger={1000000}
        onSuccess={jest.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders entry details and extension presets when open", () => {
    render(
      <BumpTtlModal
        isOpen={true}
        onClose={jest.fn()}
        entry={mockEntry}
        currentLedger={1000000}
        onSuccess={jest.fn()}
      />
    );

    expect(screen.getByText("Bump Storage Entry TTL")).toBeInTheDocument();
    expect(screen.getByText(mockEntry.keyDecoded.displayValue)).toBeInTheDocument();
    expect(screen.getByText("+10,000 ledgers")).toBeInTheDocument();
    expect(screen.getByText("+50,000 ledgers")).toBeInTheDocument();
    expect(screen.getByText("+120,000 ledgers")).toBeInTheDocument();
  });

  it("allows selecting a different preset", () => {
    render(
      <BumpTtlModal
        isOpen={true}
        onClose={jest.fn()}
        entry={mockEntry}
        currentLedger={1000000}
        onSuccess={jest.fn()}
      />
    );

    const preset120k = screen.getByText("+120,000 ledgers");
    fireEvent.click(preset120k);

    expect(screen.getByText(/#1,120,000/)).toBeInTheDocument();
  });

  it("allows entering a custom ledger amount", () => {
    render(
      <BumpTtlModal
        isOpen={true}
        onClose={jest.fn()}
        entry={mockEntry}
        currentLedger={1000000}
        onSuccess={jest.fn()}
      />
    );

    const customInput = screen.getByPlaceholderText(/e\.g\. 75000/i);
    fireEvent.change(customInput, { target: { value: "85000" } });

    expect(screen.getByText(/#1,085,000/)).toBeInTheDocument();
  });

  it("executes bump and calls onSuccess callback on invocation", async () => {
    const onSuccess = jest.fn();
    render(
      <BumpTtlModal
        isOpen={true}
        onClose={jest.fn()}
        entry={mockEntry}
        currentLedger={1000000}
        onSuccess={onSuccess}
      />
    );

    const invokeBtn = screen.getByRole("button", { name: /invoke bump ttl/i });
    fireEvent.click(invokeBtn);

    await waitFor(() => {
      expect(screen.getByText("TTL Successfully Extended!")).toBeInTheDocument();
    });

    expect(onSuccess).toHaveBeenCalledWith("entry-1", 1050000);
  });
});

// ─── StorageBrowserPage Integration Tests ────────────────────────────────────

describe("StorageBrowserPage Integration", () => {
  it("renders page title, contract input, and ABI table", () => {
    render(<StorageBrowserPage />);

    expect(screen.getByText("Contract Storage Browser")).toBeInTheDocument();
    expect(screen.getByText("ABI Decoded")).toBeInTheDocument();
    expect(screen.getAllByRole("table")[0]).toBeInTheDocument();
    expect(screen.getByText("Key (ABI Decoded)")).toBeInTheDocument();
  });

  it("renders decoded complex struct keys and enum values", () => {
    render(<StorageBrowserPage />);

    // Struct(AllowanceKey)
    expect(screen.getAllByText(/Struct\(AllowanceKey\)/i)[0]).toBeInTheDocument();
    // Struct(AllowanceData)
    expect(screen.getAllByText(/Struct\(AllowanceData\)/i)[0]).toBeInTheDocument();
    // Enum(ContractState)
    expect(screen.getAllByText(/Enum\(ContractState\)/i)[0]).toBeInTheDocument();
  });

  it("renders Bump TTL button for persistent entries and opens modal on click", () => {
    render(<StorageBrowserPage />);

    const bumpButtons = screen.getAllByRole("button", { name: /bump ttl/i });
    expect(bumpButtons.length).toBeGreaterThan(0);

    // Click first bump button
    fireEvent.click(bumpButtons[0]);

    // Modal should appear
    expect(screen.getByText("Bump Storage Entry TTL")).toBeInTheDocument();
  });

  it("filters entries by search query", () => {
    render(<StorageBrowserPage />);

    const searchInput = screen.getByPlaceholderText(/search storage keys/i);
    fireEvent.change(searchInput, { target: { value: "Counter" } });

    expect(screen.getByText("Counter")).toBeInTheDocument();
  });

  it("filters entries by durability dropdown", () => {
    render(<StorageBrowserPage />);

    const durabilitySelect = screen.getByDisplayValue("All Durabilities");
    fireEvent.change(durabilitySelect, { target: { value: "instance" } });

    // Only instance entry should be visible in durability cells
    expect(screen.getAllByText("instance").length).toBeGreaterThan(0);
  });

  it("switches to legacy tree view and back", () => {
    render(<StorageBrowserPage />);

    const treeTab = screen.getByRole("button", { name: "Tree View" });
    fireEvent.click(treeTab);

    expect(screen.getByRole("textbox", { name: /search storage/i })).toBeInTheDocument();

    const abiTab = screen.getByRole("button", { name: "ABI Table" });
    fireEvent.click(abiTab);

    expect(screen.getAllByRole("table")[0]).toBeInTheDocument();
  });
});
