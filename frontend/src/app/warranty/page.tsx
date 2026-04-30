"use client";

import { useState } from "react";
import WarrantyDashboard from "../../components/WarrantyDashboard";

const CONTRACT_ID_RE = /^C[A-Z0-9]{55}$/;
const ADDRESS_RE = /^G[A-Z0-9]{55}$/;

export default function WarrantyPage() {
  const [contractId, setContractId] = useState(process.env.NEXT_PUBLIC_WARRANTY_CONTRACT_ID?.trim() ?? "");
  const [adminAddress, setAdminAddress] = useState("");
  const [userAddress, setUserAddress] = useState("");
  const [inputs, setInputs] = useState({ contract: contractId, admin: "", user: "" });
  const [error, setError] = useState("");

  function applyConfig() {
    if (inputs.contract && !CONTRACT_ID_RE.test(inputs.contract)) return setError("Contract ID must start with C and be 56 characters.");
    if (inputs.admin && !ADDRESS_RE.test(inputs.admin)) return setError("Admin address must start with G and be 56 characters.");
    if (inputs.user && !ADDRESS_RE.test(inputs.user)) return setError("User address must start with G and be 56 characters.");
    setError("");
    setContractId(inputs.contract);
    setAdminAddress(inputs.admin);
    setUserAddress(inputs.user);
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-white">🛡️ Warranty Management</h1>
          <p className="text-sm text-gray-400 mt-1">Decentralized product warranties with automated claims on Stellar Soroban.</p>
        </header>

        <section className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3" aria-label="Connection settings">
          <h2 className="text-sm font-semibold text-gray-200">Connection</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { id: "w-contract", label: "Contract ID", key: "contract", placeholder: "C…" },
              { id: "w-admin", label: "Admin Address (optional)", key: "admin", placeholder: "G…" },
              { id: "w-user", label: "User Address (optional)", key: "user", placeholder: "G…" },
            ].map(({ id, label, key, placeholder }) => (
              <div key={key}>
                <label htmlFor={id} className="block text-xs text-gray-400 mb-1">{label}</label>
                <input id={id} value={inputs[key as keyof typeof inputs]}
                  onChange={(e) => setInputs((p) => ({ ...p, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
              </div>
            ))}
          </div>
          {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
          <button onClick={applyConfig} className="w-full py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium rounded transition-colors">Connect</button>
        </section>

        <WarrantyDashboard contractId={contractId} adminAddress={adminAddress} userAddress={userAddress} />
      </div>
    </main>
  );
}
