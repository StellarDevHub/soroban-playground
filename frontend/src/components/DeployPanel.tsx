import React from "react";
import { Play, Rocket, Hammer } from "lucide-react";

interface DeployPanelProps {
  onCompile: () => void;
  onDeploy: () => void;
  isCompiling: boolean;
  isDeploying: boolean;
  hasCompiled: boolean;
  contractId?: string;
}

export default function DeployPanel({
  onCompile,
  onDeploy,
  isCompiling,
  isDeploying,
  hasCompiled,
  contractId,
}: DeployPanelProps) {
  return (
    <div className="flex flex-col space-y-4 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center mb-2">
        <Rocket size={16} className="mr-2 text-primary-400" />
        Build & Deploy
      </h3>
      
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onCompile}
          disabled={isCompiling}
          className={`flex items-center justify-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            isCompiling
              ? "bg-gray-800 text-gray-500 cursor-not-allowed"
              : "bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 border border-blue-500/20 hover:border-blue-500/40"
          }`}
        >
          {isCompiling ? (
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-b-transparent border-gray-500 mr-2" />
          ) : (
            <Hammer size={16} className="mr-2" />
          )}
          {isCompiling ? "Compiling..." : "Compile"}
        </button>

        <button
          onClick={onDeploy}
          disabled={!hasCompiled || isDeploying}
          className={`flex items-center justify-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            !hasCompiled
              ? "bg-gray-800 text-gray-600 cursor-not-allowed opacity-50"
              : isDeploying
              ? "bg-gray-800 text-gray-500 cursor-not-allowed"
              : "bg-green-600 hover:bg-green-500 text-white shadow-[0_0_15px_rgba(22,163,74,0.3)] hover:shadow-[0_0_20px_rgba(22,163,74,0.5)]"
          }`}
        >
          {isDeploying ? (
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-b-transparent border-white mr-2" />
          ) : (
            <Play size={16} className="mr-2" />
          )}
          {isDeploying ? "Deploying..." : "Deploy to Testnet"}
        </button>
      </div>

      {contractId && (
        <div className="mt-4 p-3 bg-gray-950 border border-gray-800 rounded-lg">
          <p className="text-xs text-gray-500 mb-1 tracking-wider uppercase">Active Contract ID</p>
          <div className="font-mono text-sm text-green-400 break-all bg-gray-900 border border-green-900/50 p-2 rounded">
            {contractId}
          </div>
        </div>
      )}
    </div>
  );
}
import React from "react";
import { Play, Rocket, Hammer, CheckCircle2, AlertCircle } from "lucide-react";

interface DeployPanelProps {
  onCompile: () => void;
  onDeploy: () => void;
  isCompiling: boolean;
  isDeploying: boolean;
  hasCompiled: boolean;
  compileSummary?: string;
  compileError?: string | null;
  contractId?: string;
}

export default function DeployPanel({
  onCompile,
  onDeploy,
  isCompiling,
  isDeploying,
  hasCompiled,
  compileSummary,
  compileError,
  contractId,
}: DeployPanelProps) {
  return (
    <div className="flex flex-col space-y-4 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center mb-2">
        <Rocket size={16} className="mr-2 text-primary-400" />
        Build & Deploy
      </h3>
      
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onCompile}
          disabled={isCompiling}
          className={`flex items-center justify-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            isCompiling
              ? "bg-gray-800 text-gray-500 cursor-not-allowed"
              : "bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 border border-blue-500/20 hover:border-blue-500/40"
          }`}
        >
          {isCompiling ? (
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-b-transparent border-gray-500 mr-2" />
          ) : (
            <Hammer size={16} className="mr-2" />
          )}
          {isCompiling ? "Compiling..." : "Compile"}
        </button>

        <button
          onClick={onDeploy}
          disabled={!hasCompiled || isDeploying}
          className={`flex items-center justify-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            !hasCompiled
              ? "bg-gray-800 text-gray-600 cursor-not-allowed opacity-50"
              : isDeploying
              ? "bg-gray-800 text-gray-500 cursor-not-allowed"
              : "bg-green-600 hover:bg-green-500 text-white shadow-[0_0_15px_rgba(22,163,74,0.3)] hover:shadow-[0_0_20px_rgba(22,163,74,0.5)]"
          }`}
        >
          {isDeploying ? (
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-b-transparent border-white mr-2" />
          ) : (
            <Play size={16} className="mr-2" />
          )}
          {isDeploying ? "Deploying..." : "Deploy to Testnet"}
        </button>
      </div>

      {contractId && (
        <div className="mt-4 p-3 bg-gray-950 border border-gray-800 rounded-lg">
          <p className="text-xs text-gray-500 mb-1 tracking-wider uppercase">Active Contract ID</p>
          <div className="font-mono text-sm text-green-400 break-all bg-gray-900 border border-green-900/50 p-2 rounded">
            {contractId}
          </div>
        </div>
      )}

      {compileSummary && !compileError && (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-900/60 bg-emerald-950/40 p-3 text-sm text-emerald-200">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <p>{compileSummary}</p>
        </div>
      )}

      {compileError && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <p>{compileError}</p>
        </div>
      )}
    </div>
  );
}
