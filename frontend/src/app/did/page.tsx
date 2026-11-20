// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file did/page.tsx
 * Decentralized Identity (DID) Credential Card Designer & Studio.
 * Allows users to inspect, customize, generate verifiable presentation QR codes,
 * and export W3C credentials to mobile wallets and vector formats.
 */

"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  Award,
  Sparkles,
  Layers,
  UserCheck,
  PlusCircle,
  FileCheck2,
  Smartphone,
  CheckCircle2,
} from "lucide-react";

import DidCredentialCard from "../../components/DidCredentialCard";
import { SAMPLE_CREDENTIALS } from "../../lib/did/claimToken";
import type { VerifiableCredential } from "../../types/did";

export default function DidPage() {
  const [selectedCredIndex, setSelectedCredIndex] = useState(0);
  const [credentialsList, setCredentialsList] = useState<VerifiableCredential[]>(SAMPLE_CREDENTIALS);
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);

  // Custom credential draft form state
  const [customForm, setCustomForm] = useState({
    title: "Senior Soroban Smart Contract Developer",
    name: "Alex Vance",
    role: "Core Protocol Contributor",
    reputation: 96,
    organization: "Stellar Builders Alliance",
    stellarAddress: "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6",
    issuerName: "Soroban DAO Foundation",
  });

  const activeCredential = credentialsList[selectedCredIndex] ?? credentialsList[0];

  const handleCreateCustomCredential = (e: React.FormEvent) => {
    e.preventDefault();
    const newCred: VerifiableCredential = {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://stellar.org/soroban/did/v1",
      ],
      id: `urn:uuid:custom-cred-${Date.now()}`,
      type: ["VerifiableCredential", "SorobanCustomDeveloperCredential"],
      title: customForm.title,
      description: "Custom verifiable credential issued via Soroban Playground Identity Studio.",
      issuer: {
        id: `did:soroban:CCJDEVBHOOD7X6H6R47B5Z6T2K9QW:${customForm.issuerName.toUpperCase().replace(/\s+/g, "_")}`,
        name: customForm.issuerName,
        stellarAddress: customForm.stellarAddress,
        contractId: "CCJDEVBHOOD7X6H6R47B5Z6T2K9QW3F6V4Y5N7K8M9P1",
        network: "testnet",
      },
      issuanceDate: new Date().toISOString(),
      expirationDate: new Date(Date.now() + 365 * 86400 * 1000).toISOString(),
      credentialSubject: {
        id: `did:soroban:CDLZFC3SYJYDZT7K67VZ45IVHP2X4:${customForm.stellarAddress.slice(0, 16)}`,
        name: customForm.name,
        role: customForm.role,
        reputation: Number(customForm.reputation),
        organization: customForm.organization,
        stellarAddress: customForm.stellarAddress,
        claims: {
          skills: "Rust, Soroban SDK, TypeScript, Next.js",
          smartContractsDeployed: 12,
          securityAudited: true,
        },
      },
      proof: {
        type: "SorobanSmartContractAttestation2026",
        created: new Date().toISOString(),
        verificationMethod: `did:soroban:CCJDEVBHOOD7X6H6R47B5Z6T2K9QW:${customForm.issuerName.toUpperCase().replace(/\s+/g, "_")}#key-1`,
        proofPurpose: "assertionMethod",
        proofValue: `sig_${Math.random().toString(36).substring(2)}${Date.now()}`,
        contractAttestationHash: `0x${Math.random().toString(16).substring(2, 10)}${Math.random().toString(16).substring(2, 10)}${Date.now()}`,
      },
      status: "Active",
    };

    setCredentialsList((prev) => [newCred, ...prev]);
    setSelectedCredIndex(0);
    setIsCreatingCustom(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-500/10 border border-sky-500/30 text-sky-400">
                W3C DID v1.0 & Presentation Exchange
              </span>
              <span className="text-xs font-mono text-slate-500">Issue #2062</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
              <Award className="w-8 h-8 text-sky-400" />
              Decentralized Identity Credential Card Designer
            </h1>
            <p className="text-sm text-slate-400 max-w-2xl mt-1 leading-relaxed">
              Design, customize and export cryptographically verifiable digital credential cards for Stellar
              Soroban with ISO/IEC 18004 SVG QR code generation for mobile wallet presentation.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              data-testid="toggle-create-custom-button"
              onClick={() => setIsCreatingCustom((prev) => !prev)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs transition-all shadow-md hover:shadow-sky-500/20"
            >
              <PlusCircle className="w-4 h-4" />
              <span>{isCreatingCustom ? "Close Form" : "Create Custom Credential"}</span>
            </button>
          </div>
        </div>

        {/* Feature Highlights Banner */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center shrink-0">
              <FileCheck2 className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <div className="text-xs font-semibold text-white">W3C Standard</div>
              <div className="text-[10px] text-slate-400">JSON-LD 1.1 Validated</div>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="text-xs font-semibold text-white">Contract Attested</div>
              <div className="text-[10px] text-slate-400">Soroban on-chain proof</div>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center shrink-0">
              <Smartphone className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <div className="text-xs font-semibold text-white">Wallet Passes</div>
              <div className="text-[10px] text-slate-400">Apple & Google Wallet</div>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <div className="text-xs font-semibold text-white">SVG QR Engine</div>
              <div className="text-[10px] text-slate-400">Reed-Solomon EC L-H</div>
            </div>
          </div>
        </div>

        {/* Credential Selector Tabs */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
              Select Attested Credential
            </span>
            <span className="text-xs text-slate-500">
              {credentialsList.length} credentials available
            </span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {credentialsList.map((cred, idx) => {
              const isSelected = selectedCredIndex === idx;
              return (
                <button
                  key={cred.id}
                  type="button"
                  data-testid={`credential-select-tab-${idx}`}
                  onClick={() => setSelectedCredIndex(idx)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium border whitespace-nowrap transition-all ${
                    isSelected
                      ? "bg-sky-500/20 border-sky-400 text-white shadow-sm"
                      : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                  }`}
                >
                  <Award className="w-3.5 h-3.5 text-sky-400" />
                  <span>{cred.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Credential Builder Form (Collapsible) */}
        {isCreatingCustom && (
          <form
            data-testid="custom-credential-form"
            onSubmit={handleCreateCustomCredential}
            className="p-6 rounded-2xl bg-slate-900/90 border border-sky-500/40 backdrop-blur-md space-y-4 animate-fade-in"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-bold text-white">Create Custom Verifiable Credential</h3>
              </div>
              <span className="text-xs text-slate-400 font-mono">Generates W3C Proof & DID</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Credential Title</label>
                <input
                  type="text"
                  data-testid="custom-title-input"
                  required
                  value={customForm.title}
                  onChange={(e) => setCustomForm({ ...customForm, title: e.target.value })}
                  className="w-full p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Holder Name</label>
                <input
                  type="text"
                  data-testid="custom-name-input"
                  required
                  value={customForm.name}
                  onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
                  className="w-full p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Role / Designation</label>
                <input
                  type="text"
                  data-testid="custom-role-input"
                  required
                  value={customForm.role}
                  onChange={(e) => setCustomForm({ ...customForm, role: e.target.value })}
                  className="w-full p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Reputation Score (0-100)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  data-testid="custom-reputation-input"
                  value={customForm.reputation}
                  onChange={(e) => setCustomForm({ ...customForm, reputation: Number(e.target.value) })}
                  className="w-full p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Organization</label>
                <input
                  type="text"
                  value={customForm.organization}
                  onChange={(e) => setCustomForm({ ...customForm, organization: e.target.value })}
                  className="w-full p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Issuer Authority Name</label>
                <input
                  type="text"
                  value={customForm.issuerName}
                  onChange={(e) => setCustomForm({ ...customForm, issuerName: e.target.value })}
                  className="w-full p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-slate-400 mb-1">Stellar Wallet Public Key</label>
                <input
                  type="text"
                  value={customForm.stellarAddress}
                  onChange={(e) => setCustomForm({ ...customForm, stellarAddress: e.target.value })}
                  className="w-full p-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsCreatingCustom(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700 transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="submit-custom-credential"
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs transition-all shadow"
              >
                Issue & Design Card
              </button>
            </div>
          </form>
        )}

        {/* Live Credential Card Designer Component */}
        <DidCredentialCard
          key={activeCredential.id}
          credential={activeCredential}
          showControls={true}
        />
      </div>
    </div>
  );
}
