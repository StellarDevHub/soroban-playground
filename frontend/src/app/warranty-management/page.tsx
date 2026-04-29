"use client";

import { useState } from "react";
import WarrantyManagementPanel from "../../components/WarrantyManagementPanel";

const CONTRACT_ID_RE = /^C[A-Z0-9]{55}$/;

export default function WarrantyManagementPage() {
  const [contractId, setContractId] = useState(
    process.env.NEXT_PUBLIC_WARRANTY_CONTRACT_ID?.trim() ?? ""
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
        {/* Header */}
        <header>
          <h1 className="text-2xl font-bold text-white">🛡️ Warranty Management</h1>
          <p className="text-sm text-gray-400 mt-1">
            Decentralized warranty registration, issuance, and automated claims on Stellar Soroban.
          </p>
        </header>

        {/* Connection config */}
        <section
          className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3"
          aria-label="Connection settings"
        >
          <h2 className="text-sm font-semibold text-gray-200">Connection</h2>
          <div className="space-y-2">
            <div>
              <label htmlFor="wm-contract-id" className="block text-xs text-gray-400 mb-1">
                Contract ID
              </label>
              <input
                id="wm-contract-id"
                value={inputContract}
                onChange={(e) => setInputContract(e.target.value)}
                placeholder="C…"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                aria-describedby={contractError ? "wm-contract-error" : undefined}
              />
              {contractError && (
                <p id="wm-contract-error" className="text-xs text-red-400 mt-1" role="alert">
                  {contractError}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="wm-wallet" className="block text-xs text-gray-400 mb-1">
                Wallet Address (needed for write operations)
              </label>
              <input
                id="wm-wallet"
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
        {contractId ? (
          <WarrantyManagementPanel
            contractId={contractId}
            walletAddress={walletAddress}
          />
        ) : (
          <p className="text-sm text-gray-500 text-center py-8">
            Enter a contract ID above to get started.
          </p>
        )}
      </div>
    </main>
  );
}
