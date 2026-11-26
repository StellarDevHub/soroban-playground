import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ContractInvocationForm from "../../components/ContractInvocationForm";
import type { ContractAbiFunction } from "../../utils/contractAbi";

describe("ContractInvocationForm Component", () => {
  const mockFunction: ContractAbiFunction = {
    name: "create_escrow",
    doc: "Initialize multi-party escrow agreement",
    inputs: [
      {
        name: "beneficiary",
        type: "Address",
        doc: "Beneficiary address",
      },
      {
        name: "amount",
        type: "stroops",
        doc: "Total deposit amount",
      },
      {
        name: "memo",
        type: "Option<Symbol>",
        isOptional: true,
      },
      {
        name: "signers",
        type: "Vec<Address>",
      },
      {
        name: "tags",
        type: "Map<Symbol, u32>",
      },
    ],
  };

  it("renders function name, documentation and inputs", () => {
    render(<ContractInvocationForm abiFunction={mockFunction} />);

    expect(screen.getByText("create_escrow")).toBeInTheDocument();
    expect(screen.getByText("Initialize multi-party escrow agreement")).toBeInTheDocument();
    expect(screen.getByText("beneficiary")).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
    expect(screen.getByText("memo")).toBeInTheDocument();
    expect(screen.getByText("signers")).toBeInTheDocument();
    expect(screen.getByText("tags")).toBeInTheDocument();
  });

  it("renders badges for special Soroban types", () => {
    render(<ContractInvocationForm abiFunction={mockFunction} />);

    expect(screen.getByText("Stellar Address")).toBeInTheDocument();
    expect(screen.getByText("Stroops / Integer")).toBeInTheDocument();
    expect(screen.getByText("Vector")).toBeInTheDocument();
  });

  it("handles optional toggle correctly", () => {
    render(<ContractInvocationForm abiFunction={mockFunction} />);

    const toggleCheckbox = screen.getByTestId("toggle-optional-memo");
    expect(toggleCheckbox).not.toBeChecked();
    expect(screen.queryByTestId("input-memo")).not.toBeInTheDocument();

    // Toggle on
    fireEvent.click(toggleCheckbox);
    expect(toggleCheckbox).toBeChecked();
    expect(screen.getByTestId("input-memo")).toBeInTheDocument();
  });

  it("supports dynamic vector item addition and removal", () => {
    render(<ContractInvocationForm abiFunction={mockFunction} />);

    const addBtn = screen.getByTestId("add-vec-item-signers");
    fireEvent.click(addBtn);

    const vecItem0 = screen.getByTestId("vec-item-signers-0");
    expect(vecItem0).toBeInTheDocument();

    // Add another item
    fireEvent.click(addBtn);
    expect(screen.getByTestId("vec-item-signers-1")).toBeInTheDocument();

    // Remove first item
    const removeBtn = screen.getByTestId("remove-vec-item-signers-0");
    fireEvent.click(removeBtn);
    expect(screen.queryByTestId("vec-item-signers-1")).not.toBeInTheDocument();
  });

  it("supports dynamic map pair addition and removal", () => {
    render(<ContractInvocationForm abiFunction={mockFunction} />);

    const addBtn = screen.getByTestId("add-map-entry-tags");
    fireEvent.click(addBtn);

    expect(screen.getByTestId("map-key-tags-0")).toBeInTheDocument();
    expect(screen.getByTestId("map-val-tags-0")).toBeInTheDocument();

    const removeBtn = screen.getByTestId("remove-map-entry-tags-0");
    fireEvent.click(removeBtn);

    expect(screen.queryByTestId("map-key-tags-0")).not.toBeInTheDocument();
  });

  it("disables invoke button when required fields are empty or invalid", () => {
    render(<ContractInvocationForm abiFunction={mockFunction} />);

    const invokeBtn = screen.getByTestId("invoke-contract-btn");
    expect(invokeBtn).toBeDisabled();
    expect(screen.getByText(/Please correct validation errors/i)).toBeInTheDocument();
  });

  it("enables invoke button and triggers onInvoke with serialized ScVals when valid", () => {
    const handleInvoke = jest.fn();
    render(<ContractInvocationForm abiFunction={mockFunction} onInvoke={handleInvoke} />);

    // Fill valid address
    const addrInput = screen.getByTestId("input-beneficiary");
    fireEvent.change(addrInput, {
      target: { value: "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6" },
    });

    // Fill valid stroops
    const amountInput = screen.getByTestId("input-amount");
    fireEvent.change(amountInput, {
      target: { value: "50000000" },
    });

    const invokeBtn = screen.getByTestId("invoke-contract-btn");
    expect(invokeBtn).not.toBeDisabled();

    fireEvent.click(invokeBtn);
    expect(handleInvoke).toHaveBeenCalledTimes(1);
    expect(handleInvoke).toHaveBeenCalledWith(
      "create_escrow",
      expect.objectContaining({
        beneficiary: "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6",
        amount: "50000000",
      }),
      expect.objectContaining({
        beneficiary: {
          type: "address",
          value: "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6",
        },
        amount: {
          type: "i128",
          value: "50000000",
        },
      })
    );
  });
});
