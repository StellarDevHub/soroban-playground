import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TransactionHistory, { TransactionItem } from "../../components/TransactionHistory";

describe("TransactionHistory Component", () => {
  const mockTransactions: TransactionItem[] = [
    {
      id: "tx-1",
      hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      status: "success",
      timestamp: 1700000000000,
      ledger: 104523,
      label: "Invoke Vault Deposit",
      parsedDiff: {
        txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        successful: true,
        timestamp: 1700000000000,
        changes: [
          {
            key: "ContractData:Vault:balance:USER_1",
            keyType: "ContractData",
            changeType: "modified",
            before: { balance: 100 },
            after: { balance: 250 },
            durability: "persistent",
          },
          {
            key: "ContractData:Vault:deposit_receipt:REC_42",
            keyType: "ContractData",
            changeType: "created",
            before: null,
            after: { receiptId: "REC_42", amount: 150 },
            durability: "temporary",
          },
        ],
      },
    },
    {
      id: "tx-2",
      hash: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      status: "success",
      timestamp: 1700000060000,
      ledger: 104524,
      label: "Invoke Vault Cleanup",
      parsedDiff: {
        txHash: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        successful: true,
        timestamp: 1700000060000,
        changes: [
          {
            key: "ContractData:Vault:temporary_lock:USER_1",
            keyType: "ContractData",
            changeType: "deleted",
            before: { lockExpires: 104520 },
            after: null,
            durability: "temporary",
          },
        ],
      },
    },
  ];

  it("renders transaction history list with hashes and mutation summary badges", () => {
    render(<TransactionHistory transactions={mockTransactions} />);

    expect(screen.getByTestId("transaction-history-container")).toBeInTheDocument();
    expect(screen.getByText("Invoke Vault Deposit")).toBeInTheDocument();
    expect(screen.getByText("Ledger #104523")).toBeInTheDocument();

    // Verify mutation counters
    expect(screen.getByText("+1 created")).toBeInTheDocument();
    expect(screen.getByText("~1 modified")).toBeInTheDocument();
  });

  it("expands transaction card to display side-by-side Before/After state diffs", () => {
    render(<TransactionHistory transactions={mockTransactions} />);

    // Initially state diff viewer is not expanded
    expect(screen.queryByTestId("state-diff-viewer")).not.toBeInTheDocument();

    // Click on transaction card
    fireEvent.click(screen.getByText("Invoke Vault Deposit"));

    // State diff viewer appears
    expect(screen.getByTestId("state-diff-viewer")).toBeInTheDocument();
    expect(screen.getByText("ContractData:Vault:balance:USER_1")).toBeInTheDocument();

    // Verify Before / After panels
    const beforePanels = screen.getAllByTestId("diff-before-panel");
    const afterPanels = screen.getAllByTestId("diff-after-panel");
    expect(beforePanels.length).toBeGreaterThan(0);
    expect(afterPanels.length).toBeGreaterThan(0);

    // Modified balance diff: 100 -> 250
    expect(beforePanels[0]).toHaveTextContent(/"balance": 100/);
    expect(afterPanels[0]).toHaveTextContent(/"balance": 250/);

    // Created receipt: before is null
    expect(beforePanels[1]).toHaveTextContent("[None - Newly Created Entry]");
    expect(afterPanels[1]).toHaveTextContent(/"receiptId": "REC_42"/);
  });

  it("filters ledger state mutations by change type (created, modified, deleted)", () => {
    render(<TransactionHistory transactions={mockTransactions} />);

    // Expand tx-1
    fireEvent.click(screen.getByText("Invoke Vault Deposit"));

    // Filter by "created" only
    fireEvent.click(screen.getByTestId("filter-btn-created"));

    expect(screen.queryByText("ContractData:Vault:balance:USER_1")).not.toBeInTheDocument();
    expect(screen.getByText("ContractData:Vault:deposit_receipt:REC_42")).toBeInTheDocument();
  });

  it("searches state diffs by storage key query", () => {
    render(<TransactionHistory transactions={mockTransactions} />);

    fireEvent.click(screen.getByText("Invoke Vault Deposit"));

    const searchInput = screen.getByTestId("state-diff-search-input");
    fireEvent.change(searchInput, { target: { value: "deposit_receipt" } });

    expect(screen.queryByText("ContractData:Vault:balance:USER_1")).not.toBeInTheDocument();
    expect(screen.getByText("ContractData:Vault:deposit_receipt:REC_42")).toBeInTheDocument();
  });
});
