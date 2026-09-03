import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { WalletProvider, useWallet } from "@/components/providers/WalletProvider";

function TestAccountSync() {
  const { activeAccount, network, connect } = useWallet();
  return (
    <div>
      <div data-testid="current-account">{activeAccount}</div>
      <div data-testid="current-network">{network}</div>
      <button onClick={() => connect("freighter")}>Connect Freighter</button>
      <button onClick={() => connect("xbull")}>Connect xBull</button>
      <button onClick={() => connect("albedo")}>Connect Albedo</button>
      <button onClick={() => connect("hana")}>Connect Hana</button>
      <button onClick={() => connect("walletconnect")}>Connect WalletConnect</button>
    </div>
  );
}

describe("Network and Account Event Synchronization", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("updates account and network when custom event is dispatched", async () => {
    render(
      <WalletProvider>
        <TestAccountSync />
      </WalletProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Connect xBull"));
    });

    expect(screen.getByTestId("current-account")).toHaveTextContent(/^GXBULL/);

    // Simulate account change event from xBull
    const newAddress = "GXBULLNEWACCOUNT1234567890";
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("xbull:accountChanged", {
          detail: { address: newAddress },
        }),
      );
    });

    expect(screen.getByTestId("current-account")).toHaveTextContent(newAddress);
    expect(localStorage.getItem("preferred_account")).toBe(newAddress);

    // Simulate network change event
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("xbull:networkChanged", {
          detail: { network: "PUBLIC" },
        }),
      );
    });

    expect(screen.getByTestId("current-network")).toHaveTextContent("PUBLIC");
  });

  it("handles Albedo account events", async () => {
    render(
      <WalletProvider>
        <TestAccountSync />
      </WalletProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Connect Albedo"));
    });

    const albedoNewAddress = "GALBEDONEWACCOUNT1234567890";
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("albedo:accountChanged", {
          detail: { address: albedoNewAddress },
        }),
      );
    });

    expect(screen.getByTestId("current-account")).toHaveTextContent(albedoNewAddress);
  });

  it("handles Hana and WalletConnect account and network events", async () => {
    render(
      <WalletProvider>
        <TestAccountSync />
      </WalletProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Connect Hana"));
    });

    const hanaNewAddress = "GHANANEWACCOUNT1234567890";
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("hana:accountChanged", {
          detail: { address: hanaNewAddress },
        }),
      );
    });

    expect(screen.getByTestId("current-account")).toHaveTextContent(hanaNewAddress);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("hana:networkChanged", {
          detail: { network: "FUTURENET" },
        }),
      );
    });

    expect(screen.getByTestId("current-network")).toHaveTextContent("FUTURENET");
  });
});
