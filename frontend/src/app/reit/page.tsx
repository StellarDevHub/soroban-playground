"use client";

import { useState } from "react";
import TokenizedReitDashboard from "../../components/TokenizedReitDashboard";

const CONTRACT_ID_RE = /^C[A-Z0-9]{55}$/;
const ADDRESS_RE = /^G[A-Z0-9]{55}$/;

export default function ReitPage() {
  const [contractId, setContractId] = useState(
    process.env.NEXT_PUBLIC_REIT_CONTRACT_ID?.trim() ?? ""
  );
  const [adminAddress, setAdminAddress] = useState("");
  const [investorAddress, setInvestorAddress] = useState("");
  const [inputContract, setInputContract] = useState(contractId);
  const [inputAdmin, setInputAdmin] = useState(adminAddress);
  const [inputInvestor, setInputInvestor] = useState(investorAddress);
  const [contractError, setContractError] = useState("");

  function applyConfig() {
    if (inputContract && !CONTRACT_ID_RE.test(inputContract)) {
      setContractError("Contract ID must start with C and be 56 characters.");
      return;
    }
    if (inputAdmin && !ADDRESS_RE.test(inputAdmin)) {
      setContractError("Admin address must start with G and be 56 characters.");
      return;
    }
    if (inputInvestor && !ADDRESS_RE.test(inputInvestor)) {
      setContractError("Investor address must start with G and be 56 characters.");
      return;
    }
    setContractError("");
    setContractId(inputContract);
    setAdminAddress(inputAdmin);
    setInvestorAddress(inputInvestor);
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Page header */}
        <header>
          <h1 className="text-2xl font-bold text-white">
            🏢 Tokenized REIT
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Fractional real estate investment trusts on Stellar Soroban — buy
            shares, earn dividends, and transfer ownership on-chain.
          </p>
        </header>

        {/* Config card */}
        <section
          className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3"
          aria-label="Connection settings"
        >
          <h2 className="text-sm font-semibold text-gray-200">Connection</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="reit-contract-id"
                className="block text-xs text-gray-400 mb-1"
              >
                Contract ID
              </label>
              <input
                id="reit-contract-id"
                value={inputContract}
                onChange={(e) => setInputContract(e.target.value)}
                placeholder="C…"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                aria-describedby={contractError ? "reit-contract-error" : undefined}
              />
            </div>
            <div>
              <label
                htmlFor="reit-admin"
                className="block text-xs text-gray-400 mb-1"
              >
                Admin Address (optional)
              </label>
              <input
                id="reit-admin"
                value={inputAdmin}
                onChange={(e) => setInputAdmin(e.target.value)}
                placeholder="G…"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label
                htmlFor="reit-investor"
                className="block text-xs text-gray-400 mb-1"
              >
                Investor Address (optional)
              </label>
              <input
                id="reit-investor"
                value={inputInvestor}
                onChange={(e) => setInputInvestor(e.target.value)}
                placeholder="G…"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          {contractError && (
            <p id="reit-contract-error" className="text-xs text-red-400" role="alert">
              {contractError}
            </p>
          )}
          <button
            onClick={applyConfig}
            className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors"
          >
            Connect
          </button>
        </section>

        {/* Dashboard */}
        <TokenizedReitDashboard
          contractId={contractId}
          adminAddress={adminAddress}
          investorAddress={investorAddress}
        />
      </div>
    </main>
  );
}
