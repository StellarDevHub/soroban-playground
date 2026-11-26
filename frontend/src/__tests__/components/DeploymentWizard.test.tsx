import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DeploymentWizard, {
  createDeploymentTransaction,
  estimateStorageDepositStroops,
  validateConstructorParam,
} from "../../components/DeploymentWizard";
import { NETWORKS } from "../../components/NetworkSwitcher";
import type { ContractAbiFunction } from "../../utils/contractAbi";

const VALID_STELLAR_ADDRESS =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const SAMPLE_ABI: ContractAbiFunction[] = [
  {
    name: "initialize",
    inputs: [
      { name: "admin", type: "Address" },
      { name: "decimals", type: "u8" },
      { name: "supply", type: "u128" },
    ],
  },
];

describe("DeploymentWizard", () => {
  it("renders all four multi-network presets and transitions across wizard steps", async () => {
    const onDeploy = jest.fn().mockResolvedValue({
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    });

    render(
      <DeploymentWizard
        abi={SAMPLE_ABI}
        wasmByteLength={10_000}
        onDeploy={onDeploy}
      />,
    );

    // Step 1: Network presets
    expect(screen.getByTestId("wizard-step-network")).toBeInTheDocument();
    expect(screen.getByTestId("network-preset-testnet")).toBeInTheDocument();
    expect(screen.getByTestId("network-preset-futurenet")).toBeInTheDocument();
    expect(screen.getByTestId("network-preset-mainnet")).toBeInTheDocument();
    expect(screen.getByTestId("network-preset-local")).toBeInTheDocument();

    // Select Futurenet
    fireEvent.click(screen.getByTestId("network-preset-futurenet"));
    fireEvent.click(
      screen.getByRole("button", { name: /Next: Constructor Parameters/i }),
    );

    // Step 2: Constructor Parameters
    expect(screen.getByTestId("wizard-step-parameters")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/admin/i), {
      target: { value: VALID_STELLAR_ADDRESS },
    });
    fireEvent.change(screen.getByLabelText(/decimals/i), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText(/supply/i), {
      target: { value: "1000000" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Next: Review & Estimate/i }),
    );

    // Step 3: Review & Storage Deposit Estimate in Stroops
    expect(screen.getByTestId("wizard-step-review")).toBeInTheDocument();
    expect(screen.getByTestId("storage-deposit-estimate")).toBeInTheDocument();
    expect(screen.getByTestId("total-stroops-value").textContent).toMatch(
      /Stroops/,
    );
    expect(screen.getByText(NETWORKS.futurenet.passphrase)).toBeInTheDocument();

    // Confirm deployment
    fireEvent.click(
      screen.getByRole("button", { name: /Confirm & Deploy to Futurenet/i }),
    );

    await waitFor(() => {
      expect(onDeploy).toHaveBeenCalledTimes(1);
    });

    const tx = onDeploy.mock.calls[0][0];
    expect(tx.networkId).toBe("futurenet");
    expect(tx.rpcUrl).toBe(NETWORKS.futurenet.rpcUrl);
    expect(tx.networkPassphrase).toBe(NETWORKS.futurenet.passphrase);
    expect(tx.constructorName).toBe("initialize");
    expect(tx.constructorArgs).toEqual({
      admin: VALID_STELLAR_ADDRESS,
      decimals: 7,
      supply: "1000000",
    });
    expect(tx.estimatedStorageDepositStroops).toBeGreaterThan(0);

    expect(await screen.findByTestId("deployment-success")).toBeInTheDocument();
  });

  it("blocks advancing to review when address is invalid or integer overflows", () => {
    render(<DeploymentWizard abi={SAMPLE_ABI} />);

    fireEvent.click(
      screen.getByRole("button", { name: /Next: Constructor Parameters/i }),
    );

    fireEvent.change(screen.getByLabelText(/admin/i), {
      target: { value: "INVALID_ADDR" },
    });
    fireEvent.change(screen.getByLabelText(/decimals/i), {
      target: { value: "300" }, // overflows u8 (0..255)
    });
    fireEvent.change(screen.getByLabelText(/supply/i), {
      target: { value: "-5" }, // negative for u128
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Next: Review & Estimate/i }),
    );

    // Should stay on parameters step and show validation alerts
    expect(screen.getByTestId("wizard-step-parameters")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-step-review")).not.toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(3);
  });

  it("validates integer overflow bounds and creates deployment transaction only when valid", () => {
    expect(
      validateConstructorParam({ name: "count", type: "u8" }, "256"),
    ).toMatch(/overflows u8/i);
    expect(
      validateConstructorParam({ name: "count", type: "u8" }, "255"),
    ).toBeNull();

    const invalidResult = createDeploymentTransaction({
      networkId: "local",
      constructorFn: SAMPLE_ABI[0],
      rawValues: { admin: "bad", decimals: "999", supply: "10" },
      wasmByteLength: 4096,
    });
    expect(invalidResult.transaction).toBeUndefined();
    expect(Object.keys(invalidResult.errors)).toEqual(
      expect.arrayContaining(["admin", "decimals"]),
    );

    const validResult = createDeploymentTransaction({
      networkId: "local",
      constructorFn: SAMPLE_ABI[0],
      rawValues: {
        admin: VALID_STELLAR_ADDRESS,
        decimals: "8",
        supply: "500000",
      },
      wasmByteLength: 4096,
    });
    expect(validResult.errors).toEqual({});
    expect(validResult.transaction).toBeDefined();
    expect(validResult.transaction?.networkPassphrase).toBe(
      NETWORKS.local.passphrase,
    );
    expect(validResult.transaction?.estimatedStorageDepositStroops).toBe(
      estimateStorageDepositStroops(4096, {
        admin: VALID_STELLAR_ADDRESS,
        decimals: 8,
        supply: "500000",
      }).totalStroops,
    );
  });
});
