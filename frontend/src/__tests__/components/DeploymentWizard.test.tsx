import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import DeploymentWizard from "../../components/DeploymentWizard";
import type { ContractAbiFunction } from "../../utils/contractAbi";

describe("DeploymentWizard Component", () => {
  const mockAbi: ContractAbiFunction[] = [
    {
      name: "initialize",
      inputs: [
        { name: "admin", type: "Address" },
        { name: "initial_supply", type: "i128" },
      ],
    },
  ];

  it("renders wizard with multi-network presets (Testnet, Futurenet, Mainnet, Local)", () => {
    render(<DeploymentWizard isOpen={true} abi={mockAbi} />);

    expect(screen.getByTestId("deployment-wizard-modal")).toBeInTheDocument();
    expect(screen.getByTestId("network-preset-testnet")).toBeInTheDocument();
    expect(screen.getByTestId("network-preset-futurenet")).toBeInTheDocument();
    expect(screen.getByTestId("network-preset-mainnet")).toBeInTheDocument();
    expect(screen.getByTestId("network-preset-local")).toBeInTheDocument();
  });

  it("validates constructor argument types and blocks advancing on invalid address or missing fields", () => {
    render(<DeploymentWizard isOpen={true} abi={mockAbi} />);

    // Advance to Step 2 (Constructor args)
    fireEvent.click(screen.getByTestId("proceed-to-args-btn"));

    expect(screen.getByTestId("wizard-step-constructor")).toBeInTheDocument();
    expect(screen.getByTestId("arg-input-admin")).toBeInTheDocument();
    expect(screen.getByTestId("arg-input-initial_supply")).toBeInTheDocument();

    // Try to advance with empty inputs
    fireEvent.click(screen.getByTestId("proceed-to-confirmation-btn"));

    // Should display validation errors
    expect(screen.getByTestId("validation-error-admin")).toHaveTextContent(/required/i);

    // Provide invalid address
    fireEvent.change(screen.getByTestId("arg-input-admin"), {
      target: { value: "invalid_address_123" },
    });
    fireEvent.click(screen.getByTestId("proceed-to-confirmation-btn"));
    expect(screen.getByTestId("validation-error-admin")).toHaveTextContent(
      /must be a valid Stellar Address/i
    );

    // Provide valid Stellar address and integer
    fireEvent.change(screen.getByTestId("arg-input-admin"), {
      target: { value: "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6" },
    });
    fireEvent.change(screen.getByTestId("arg-input-initial_supply"), {
      target: { value: "1000000000" },
    });

    // Advance to confirmation
    fireEvent.click(screen.getByTestId("proceed-to-confirmation-btn"));
    expect(screen.getByTestId("wizard-step-confirmation")).toBeInTheDocument();
  });

  it("displays estimated initial storage deposit cost in Stroops", () => {
    render(<DeploymentWizard isOpen={true} abi={mockAbi} wasmSize={32000} />);

    // Step 1 -> Step 2
    fireEvent.click(screen.getByTestId("proceed-to-args-btn"));

    // Valid inputs
    fireEvent.change(screen.getByTestId("arg-input-admin"), {
      target: { value: "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6" },
    });
    fireEvent.change(screen.getByTestId("arg-input-initial_supply"), {
      target: { value: "5000" },
    });

    // Step 2 -> Step 3
    fireEvent.click(screen.getByTestId("proceed-to-confirmation-btn"));

    // Check storage deposit display in Stroops
    const stroopsDisplay = screen.getByTestId("storage-deposit-stroops");
    expect(stroopsDisplay).toHaveTextContent(/Stroops/i);
    expect(screen.getByText(/Estimated Initial Storage Deposit/i)).toBeInTheDocument();
  });

  it("executes deployment and displays deployed contract ID and transaction hash", async () => {
    const handleDeploy = jest.fn().mockResolvedValueOnce({
      contractId: "CABX123456789012345678901234567890123456789012345678901234",
      txHash: "0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
      network: "testnet",
    });

    render(
      <DeploymentWizard
        isOpen={true}
        abi={mockAbi}
        onDeploy={handleDeploy}
      />
    );

    // Navigate to confirmation
    fireEvent.click(screen.getByTestId("proceed-to-args-btn"));
    fireEvent.change(screen.getByTestId("arg-input-admin"), {
      target: { value: "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6" },
    });
    fireEvent.change(screen.getByTestId("arg-input-initial_supply"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByTestId("proceed-to-confirmation-btn"));

    // Click Confirm & Broadcast
    fireEvent.click(screen.getByTestId("confirm-deploy-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("wizard-step-complete")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Smart Contract Deployed Successfully!")
    ).toBeInTheDocument();
    expect(screen.getByTestId("deployed-contract-id")).toHaveTextContent(
      "CABX123456789012345678901234567890123456789012345678901234"
    );
  });
});
