"use client";

import React, { useState } from "react";
import Editor from "@/components/Editor";
import Console from "@/components/Console";
import DeployPanel from "@/components/DeployPanel";
import CallPanel from "@/components/CallPanel";
import StorageViewer from "@/components/StorageViewer";
import { Sparkles, Code2, BookOpen } from "lucide-react";

const DEFAULT_CODE = `#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol};

#[contract]
pub struct HelloContract;

#[contractimpl]
impl HelloContract {
    pub fn hello(env: Env, name: Symbol) -> Symbol {
        name
    }
}
`;

export default function Home() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [logs, setLogs] = useState<string[]>([]);
  
  // Status states
  const [isCompiling, setIsCompiling] = useState(false);
  const [hasCompiled, setHasCompiled] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isInvoking, setIsInvoking] = useState(false);
  
  // Contract Data
  const [contractId, setContractId] = useState<string | undefined>(undefined);
  const [storage, setStorage] = useState<Record<string, string>>({});

  const appendLog = (msg: string) => setLogs((prev) => [...prev, msg]);

  const handleCompile = async () => {
    setIsCompiling(true);
    appendLog("Compiling contract...");
    
    // Simulate backend call
    setTimeout(() => {
      setIsCompiling(false);
      setHasCompiled(true);
      appendLog("✓ Compilation successful");
      appendLog("WASM size: 14.5 KB");
    }, 2000);
  };

  const handleDeploy = async () => {
    setIsDeploying(true);
    appendLog("Deploying to Stellar Testnet...");
    
    // Simulate deployment
    setTimeout(() => {
      setIsDeploying(false);
      const newContractId = "C" + Math.random().toString(36).substring(2, 34).toUpperCase();
      setContractId(newContractId);
      appendLog(`✓ Contract deployed successfully`);
      appendLog(`Contract ID: ${newContractId}`);
      setStorage({ "admin": "G" + Math.random().toString(36).substring(2, 34).toUpperCase() });
    }, 2500);
  };

  const handleInvoke = async (funcName: string, args: Record<string, string>) => {
    setIsInvoking(true);
    appendLog(`Invoking ${contractId} -> ${funcName}(${JSON.stringify(args)})`);
    
    // Simulate call
    setTimeout(() => {
      setIsInvoking(false);
      if (funcName === "hello" && args.name) {
        appendLog(`✓ Return value: "${args.name}"`);
        setStorage((prev) => ({ ...prev, "last_hello": args.name }));
      } else {
        appendLog("✓ Call completed successfully. Check storage.");
      }
    }, 1500);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0A0A0A]">
      {/* Navbar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-blue-500 flex items-center justify-center shadow-[0_0_15px_rgba(147,51,234,0.4)]">
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-400">
              Soroban Playground
            </h1>
            <p className="text-xs text-gray-500 tracking-wider">Browser-based Stellar IDE</p>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <a href="#" className="flex items-center text-sm text-gray-400 hover:text-gray-200 transition">
            <BookOpen size={16} className="mr-2" /> Docs
          </a>
          <button className="flex items-center px-4 py-2 bg-gray-800 hover:bg-gray-700 text-sm font-medium rounded-lg transition border border-gray-700">
            <Code2 size={16} className="mr-2" /> Load Template
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left pane: Editor */}
        <section className="flex-1 flex flex-col p-4 border-r border-gray-800">
          <div className="flex items-center justify-between mb-3 px-2">
            <span className="text-sm font-semibold text-gray-400 tracking-wider uppercase flex items-center">
              <Code2 size={16} className="mr-2" /> Contract Code
            </span>
            <span className="text-xs text-gray-600">lib.rs</span>
          </div>
          <Editor code={code} setCode={setCode} />
        </section>

        {/* Right pane: Controls & Terminal */}
        <section className="w-[450px] min-w-[350px] flex flex-col p-4 overflow-y-auto space-y-4 bg-[#0F0F0F]">
          <DeployPanel 
            onCompile={handleCompile}
            onDeploy={handleDeploy}
            isCompiling={isCompiling}
            isDeploying={isDeploying}
            hasCompiled={hasCompiled}
            contractId={contractId}
          />
          <CallPanel 
            onInvoke={handleInvoke}
            isInvoking={isInvoking}
            contractId={contractId}
          />
          <StorageViewer storage={storage} />
          
          <div className="mt-auto pt-4">
            <Console logs={logs} />
          </div>
        </section>
      </main>
    </div>
  );
}
