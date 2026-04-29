"use client";

import { useState } from "react";
import SportsPredictionMarketPanel from "../../components/SportsPredictionMarketPanel";

const CONTRACT_ID_RE = /^C[A-Z0-9]{55}$/;

export default function SportsPredictionPage() {
  const [contractId, setContractId] = useState(
    process.env.NEXT_PUBLIC_SPORTS_MARKET_CONTRACT_ID?.trim() ?? ""
  );
  const [walletAddress, setWalletAddress] = useState("");
  const [inputContract, setInputContract] = useState(contractId);
  const [inputWallet, setInputWallet] = useState(walletAddress);
  const [contractError, setContractError] = useState("");

  function applyConfig() {
    if (inputContract && !CONTRACT_ID_RE.test(inputContract)) {
      setContractError("Contract ID must start with C and be 56 characters.");
      return;
    }
    setContractError("");
    setContractId(inputContract);
    setWalletAddress(inputWallet);
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Page header */}
        <header>
          <h1 className="text-2xl font-bold text-white">
            🏆 Sports Prediction Market
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Decentralized sports betting on Stellar Soroban — place bets, track
            live odds, and claim payouts on-chain.
          </p>
        </header>

        {/* Config card */}
        <section
          className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3"
          aria-label="Connection settings"
        >
          <h2 className="text-sm font-semibold text-gray-200">Connection</h2>
          <div className="space-y-2">
            <div>
              <label
                htmlFor="sp-contract-id"
                className="block text-xs text-gray-400 mb-1"
              >
                Contract ID
              </label>
              <input
                id="sp-contract-id"
                value={inputContract}
                onChange={(e) => setInputContract(e.target.value)}
                placeholder="C…"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                aria-describedby={contractError ? "sp-contract-error" : undefined}
              />
              {contractError && (
                <p id="sp-contract-error" className="text-xs text-red-400 mt-1" role="alert">
                  {contractError}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="sp-wallet"
                className="block text-xs text-gray-400 mb-1"
              >
                Wallet Address (optional — needed to place bets)
              </label>
              <input
                id="sp-wallet"
                value={inputWallet}
                onChange={(e) => setInputWallet(e.target.value)}
                placeholder="G…"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              onClick={applyConfig}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded transition-colors"
            >
              Connect
            </button>
          </div>
        </section>

        {/* Panel */}
        <SportsPredictionMarketPanel
          contractId={contractId}
          walletAddress={walletAddress}
        />
      </div>
    </main>
  );
}
