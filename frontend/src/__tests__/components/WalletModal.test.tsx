import React from "react";
import { render, screen } from "@testing-library/react";
import WalletModal from "@/components/WalletModal";
import { WalletProvider } from "@/components/providers/WalletProvider";

describe("WalletModal", () => {
  it("renders all wallet options and information correctly", () => {
    render(
      <WalletProvider>
        <WalletModal isOpen={true} onClose={jest.fn()} />
      </WalletProvider>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Connect Stellar Wallet")).toBeInTheDocument();
    expect(screen.getByText("Freighter")).toBeInTheDocument();
    expect(screen.getByText("xBull Wallet")).toBeInTheDocument();
    expect(screen.getByText("Albedo Link")).toBeInTheDocument();
    expect(screen.getByText("Hana Wallet")).toBeInTheDocument();
    expect(screen.getByText("WalletConnect (SEP-0043)")).toBeInTheDocument();
    expect(screen.getByText("Rango Suite")).toBeInTheDocument();
  });
});
