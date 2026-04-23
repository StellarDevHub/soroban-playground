"use client";

import React, { useState } from "react";
import Editor from "@/components/Editor";
import Console from "@/components/Console";
import DeployPanel from "@/components/DeployPanel";
import CallPanel from "@/components/CallPanel";
import StorageViewer from "@/components/StorageViewer";
import TransactionCallGraph from "@/components/TransactionCallGraph";
import {
  parseTransactionInvocationPayload,
  type TransactionCallGraph as TransactionCallGraphState,
  type LedgerState,
} from "@/utils/transactionGraph";
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

function shortId(contractId: string): string {
  return contractId.length > 14 ? `${contractId.slice(0, 8)}...${contractId.slice(-4)}` : contractId;
}

function createMockInvocationPayload(
  contractId: string,
  funcName: string,
  args: Record<string, string>,
  baseStorage: LedgerState,
): unknown {
  const timestamp = Date.now();
  const serializedArgs = JSON.stringify(args);
  const userName = args.name ?? "anonymous";
  const rootStorage = {
    ...baseStorage,
    last_function: funcName,
    last_args: serializedArgs,
    last_invoked_at: new Date(timestamp).toISOString(),
  };

  const routerContract = `ROUTER_${shortId(contractId)}`;
  const tokenContract = `TOKEN_${shortId(contractId)}`;
  const auditContract = `AUDIT_${shortId(contractId)}`;

  return {
    txHash: `0x${Math.random().toString(16).slice(2).padEnd(64, "0")}`,
    invocationTree: {
      id: `root-${timestamp}`,
      contractId,
      function: funcName,
      args,
      result: funcName === "hello" ? userName : "ok",
      ledgerState: rootStorage,
      children: [
        {
          id: `router-${timestamp}`,
          contract: routerContract,
          fn: "route_call",
          args: {
            target: tokenContract,
            original_method: funcName,
          },
          result: "forwarded",
          ledgerState: {
            route_count: String(Number(baseStorage.route_count ?? "0") + 1),
            last_route_target: tokenContract,
          },
          children: [
            {
              id: `token-${timestamp}`,
              contractId: tokenContract,
              method: "write_checkpoint",
              arguments: {
                checkpoint_key: `tx:${timestamp}`,
                greeting: userName,
              },
              output: "checkpoint_written",
              storage: {
                last_greeting: userName,
                checkpoint_count: String(Number(baseStorage.checkpoint_count ?? "0") + 1),
              },
              children: [],
            },
          ],
        },
        {
          id: `audit-${timestamp}`,
          contract_id: auditContract,
          entrypoint: "audit_event",
          params: {
            caller_contract: contractId,
            invoked_function: funcName,
          },
          returnValue: "audit_ok",
          state: {
            audit_trail_size: String(Number(baseStorage.audit_trail_size ?? "0") + 1),
            last_audited_fn: funcName,
          },
          subInvocations: [],
        },
      ],
    },
  };
}

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
  const [storage, setStorage] = useState<LedgerState>({});
  const [storageContextLabel, setStorageContextLabel] = useState<string>("Latest contract snapshot");
  const [transactionGraph, setTransactionGraph] = useState<TransactionCallGraphState>({
    nodes: [],
    edges: [],
  });
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | undefined>(undefined);

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
      setTransactionGraph({ nodes: [], edges: [] });
      setSelectedGraphNodeId(undefined);

      appendLog("✓ Contract deployed successfully");
      appendLog(`Contract ID: ${newContractId}`);

      const deployedState = {
        admin: "G" + Math.random().toString(36).substring(2, 34).toUpperCase(),
        checkpoint_count: "0",
        route_count: "0",
        audit_trail_size: "0",
      };

      setStorage(deployedState);
      setStorageContextLabel("Latest contract snapshot");
    }, 2500);
  };

  const handleGraphNodeSelect = (nodeId: string) => {
    setSelectedGraphNodeId(nodeId);
    const selectedNode = transactionGraph.nodes.find((node) => node.id === nodeId);

    if (!selectedNode) {
      return;
    }

    setStorage(selectedNode.ledgerState);
    setStorageContextLabel(`Snapshot at ${selectedNode.contractId}.${selectedNode.functionName}`);
    appendLog(`Inspecting call node: ${selectedNode.contractId} -> ${selectedNode.functionName}`);
  };

  const handleInvoke = async (funcName: string, args: Record<string, string>) => {
    if (!contractId) {
      return;
    }

    setIsInvoking(true);
    appendLog(`Invoking ${contractId} -> ${funcName}(${JSON.stringify(args)})`);

    // Simulate call result payload with nested contract invocations.
    setTimeout(() => {
      setIsInvoking(false);

      const invocationPayload = createMockInvocationPayload(contractId, funcName, args, storage);
      const parsedGraph = parseTransactionInvocationPayload(invocationPayload);
      setTransactionGraph(parsedGraph);

      if (parsedGraph.nodes.length === 0) {
        appendLog("⚠ No invocation graph could be derived from payload.");
        return;
      }

      const terminalNode = parsedGraph.nodes[parsedGraph.nodes.length - 1];
      setSelectedGraphNodeId(terminalNode.id);
      setStorage(terminalNode.ledgerState);
      setStorageContextLabel(`Snapshot at ${terminalNode.contractId}.${terminalNode.functionName}`);

      const uniqueContracts = new Set(parsedGraph.nodes.map((node) => node.contractId)).size;
      appendLog(`✓ Captured invocation tree: ${parsedGraph.nodes.length} calls across ${uniqueContracts} contracts.`);

      if (funcName === "hello" && args.name) {
        appendLog(`✓ Return value: "${args.name}"`);
      } else {
        appendLog("✓ Call completed successfully. Click graph nodes to inspect intermediate ledger snapshots.");
      }
    }, 1400);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0A0A0A]">
      {/* Navbar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-500 flex items-center justify-center shadow-[0_0_15px_rgba(8,145,178,0.4)]">
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 to-blue-400">
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
        <section className="w-[520px] min-w-[380px] flex flex-col p-4 overflow-y-auto space-y-4 bg-[#0F0F0F]">
          <DeployPanel
            onCompile={handleCompile}
            onDeploy={handleDeploy}
            isCompiling={isCompiling}
            isDeploying={isDeploying}
            hasCompiled={hasCompiled}
            contractId={contractId}
          />
          <CallPanel onInvoke={handleInvoke} isInvoking={isInvoking} contractId={contractId} />
          <TransactionCallGraph
            graph={transactionGraph}
            selectedNodeId={selectedGraphNodeId}
            onNodeSelect={handleGraphNodeSelect}
          />
          <StorageViewer storage={storage} contextLabel={storageContextLabel} />

          <div className="mt-auto pt-4">
            <Console logs={logs} />
          </div>
        </section>
      </main>
    </div>
  );
}
