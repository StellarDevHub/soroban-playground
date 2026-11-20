"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
  Rocket,
  Shield,
  Layers,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Server,
  Cpu,
  Coins,
  X,
  HelpCircle,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { NETWORKS, NetworkId, NetworkConfig } from "@/components/NetworkSwitcher";
import {
  ContractAbiFunction,
  validateSorobanType,
} from "@/utils/contractAbi";

export interface DeploymentSubmission {
  network: NetworkConfig;
  contractName: string;
  constructorFunctionName: string;
  constructorArgs: Record<string, unknown>;
  estimatedStorageDepositStroops: number;
}

export interface DeploymentResult {
  contractId: string;
  txHash: string;
  network: string;
}

export interface DeploymentWizardProps {
  isOpen?: boolean;
  onClose?: () => void;
  contractName?: string;
  wasmBase64?: string;
  wasmSize?: number;
  abi?: ContractAbiFunction[];
  initialNetwork?: NetworkId;
  onDeploy?: (data: DeploymentSubmission) => Promise<DeploymentResult>;
  onSuccess?: (result: DeploymentResult) => void;
  className?: string;
}

type WizardStep = "network" | "constructor" | "confirmation" | "deploying" | "complete";

export default function DeploymentWizard({
  isOpen = true,
  onClose,
  contractName = "SmartContract",
  wasmBase64,
  wasmSize = 24500,
  abi = [],
  initialNetwork = "testnet",
  onDeploy,
  onSuccess,
  className = "",
}: DeploymentWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>("network");
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkId>(initialNetwork);
  const [constructorArgs, setConstructorArgs] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentResult, setDeploymentResult] = useState<DeploymentResult | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  // Find constructor / initialization function from ABI
  const initFunction = useMemo(() => {
    return (
      abi.find(
        (f) =>
          f.name === "__constructor" ||
          f.name === "initialize" ||
          f.name === "init" ||
          f.name.toLowerCase().includes("init")
      ) ||
      abi[0] ||
      null
    );
  }, [abi]);

  // Compute estimated storage deposit in Stroops (base footprint + WASM size multiplier)
  // 1 XLM = 10,000,000 Stroops
  const estimatedStorageDepositStroops = useMemo(() => {
    const wasmKb = Math.ceil(wasmSize / 1024);
    // Base footprint: 50,000 Stroops + 2,000 Stroops per KB
    return 50000 + wasmKb * 2000;
  }, [wasmSize]);

  const handleArgChange = (paramName: string, paramType: string, value: string) => {
    setConstructorArgs((prev) => ({ ...prev, [paramName]: value }));

    // Client-side type validation
    const error = validateSorobanType(paramName, paramType, value);
    setValidationErrors((prev) => {
      const next = { ...prev };
      if (error) {
        next[paramName] = error;
      } else {
        delete next[paramName];
      }
      return next;
    });
  };

  const validateAllArgs = useCallback(() => {
    if (!initFunction || !initFunction.inputs || initFunction.inputs.length === 0) {
      return true;
    }

    const errors: Record<string, string> = {};
    for (const input of initFunction.inputs) {
      const val = constructorArgs[input.name] ?? "";
      const err = validateSorobanType(input.name, input.type, val);
      if (err) {
        errors[input.name] = err;
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [initFunction, constructorArgs]);

  const handleProceedToConfirmation = () => {
    if (validateAllArgs()) {
      setCurrentStep("confirmation");
    }
  };

  const handleExecuteDeployment = async () => {
    setCurrentStep("deploying");
    setIsDeploying(true);
    setDeployError(null);

    const submission: DeploymentSubmission = {
      network: NETWORKS[selectedNetwork],
      contractName,
      constructorFunctionName: initFunction?.name || "initialize",
      constructorArgs,
      estimatedStorageDepositStroops,
    };

    try {
      let result: DeploymentResult;
      if (onDeploy) {
        result = await onDeploy(submission);
      } else {
        // Fallback simulated deployment
        await new Promise((resolve) => setTimeout(resolve, 1500));
        result = {
          contractId: `C${Math.random().toString(36).substring(2, 10).toUpperCase()}4567890123456789012345678901234567890123456789`,
          txHash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`,
          network: selectedNetwork,
        };
      }

      setDeploymentResult(result);
      setCurrentStep("complete");
      onSuccess?.(result);
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : String(err));
      setCurrentStep("confirmation");
    } finally {
      setIsDeploying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="deployment-wizard-title"
      data-testid="deployment-wizard-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        className={`w-full max-w-2xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 ${className}`}
      >
        {/* Header with Step Indicator */}
        <div className="p-5 border-b border-white/10 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400">
              <Rocket size={20} />
            </div>
            <div>
              <h2
                id="deployment-wizard-title"
                className="text-base font-bold text-white tracking-tight"
              >
                Smart Contract Deployment Wizard
              </h2>
              <p className="text-xs text-slate-400">
                Deploy <span className="font-mono text-violet-300">{contractName}</span> with multi-network presets and type validation.
              </p>
            </div>
          </div>

          {onClose && (
            <button
              type="button"
              data-testid="close-deployment-wizard"
              aria-label="Close deployment wizard"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Wizard Stepper Bar */}
        <div className="px-6 py-3 bg-slate-950/30 border-b border-white/5 flex items-center justify-between text-xs">
          {[
            { id: "network", label: "1. Network Preset" },
            { id: "constructor", label: "2. Initializer Args" },
            { id: "confirmation", label: "3. Deposit & Review" },
          ].map((step, idx) => {
            const isActive = currentStep === step.id;
            const isPassed =
              (step.id === "network" && currentStep !== "network") ||
              (step.id === "constructor" && (currentStep === "confirmation" || currentStep === "complete"));

            return (
              <div
                key={step.id}
                data-testid={`stepper-step-${step.id}`}
                className={`flex items-center gap-2 font-semibold ${
                  isActive
                    ? "text-violet-400"
                    : isPassed
                    ? "text-emerald-400"
                    : "text-slate-500"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    isActive
                      ? "bg-violet-600 text-white"
                      : isPassed
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {isPassed ? "✓" : idx + 1}
                </div>
                <span>{step.label}</span>
              </div>
            );
          })}
        </div>

        {/* Wizard Body */}
        <div className="p-6 flex-1 overflow-y-auto space-y-6">
          {deployError && (
            <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-200 text-xs flex items-center gap-2">
              <AlertTriangle size={16} className="text-rose-400 shrink-0" />
              <span>{deployError}</span>
            </div>
          )}

          {/* STEP 1: Network Selection */}
          {currentStep === "network" && (
            <div className="space-y-4" data-testid="wizard-step-network">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">
                  Select Deployment Network Preset
                </h3>
                <p className="text-xs text-slate-400">
                  Target network RPC and network passphrase configuration.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(Object.keys(NETWORKS) as NetworkId[]).map((netId) => {
                  const net = NETWORKS[netId];
                  const isSelected = selectedNetwork === netId;

                  return (
                    <div
                      key={netId}
                      data-testid={`network-preset-${netId}`}
                      onClick={() => setSelectedNetwork(netId)}
                      className={`p-4 rounded-xl border cursor-pointer transition-all ${
                        isSelected
                          ? "bg-violet-500/10 border-violet-500/40 shadow-sm"
                          : "bg-slate-950/40 border-white/5 hover:border-white/10"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="network_preset"
                            checked={isSelected}
                            onChange={() => setSelectedNetwork(netId)}
                            className="text-violet-600 focus:ring-violet-500"
                          />
                          <span className="font-bold text-sm text-white capitalize">
                            {net.name}
                          </span>
                        </div>
                        {netId === "testnet" && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            Recommended
                          </span>
                        )}
                        {netId === "mainnet" && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            Live Funds
                          </span>
                        )}
                      </div>

                      <div className="mt-2 text-[11px] font-mono text-slate-400 truncate">
                        {net.rpcUrl}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 2: Constructor / Initializer Argument Validation */}
          {currentStep === "constructor" && (
            <div className="space-y-4" data-testid="wizard-step-constructor">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Constructor & Initialization Arguments</span>
                  {initFunction && (
                    <span className="text-xs font-mono font-normal text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded">
                      fn {initFunction.name}()
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-400">
                  Client-side type validation against parsed contract ABI prevents transaction rejection and lost fee deposits.
                </p>
              </div>

              {!initFunction || !initFunction.inputs || initFunction.inputs.length === 0 ? (
                <div className="p-6 rounded-xl bg-slate-950/40 border border-white/5 text-center text-xs text-slate-400">
                  <CheckCircle2 size={24} className="mx-auto text-emerald-400 mb-2" />
                  <p className="font-medium text-slate-200">No Initialization Arguments Required</p>
                  <p className="text-[11px] mt-1">This contract can be deployed without initial constructor parameters.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {initFunction.inputs.map((input) => {
                    const hasError = Boolean(validationErrors[input.name]);
                    const errorMsg = validationErrors[input.name];

                    return (
                      <div
                        key={input.name}
                        data-testid={`constructor-arg-group-${input.name}`}
                        className="rounded-xl bg-slate-950/60 border border-white/5 p-3.5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <label
                            htmlFor={`arg-${input.name}`}
                            className="font-bold text-slate-300 font-mono"
                          >
                            {input.name}
                          </label>
                          <span className="text-[10px] font-mono text-violet-300 bg-slate-900 px-2 py-0.5 rounded border border-white/5">
                            Type: {input.type}
                          </span>
                        </div>

                        <input
                          id={`arg-${input.name}`}
                          data-testid={`arg-input-${input.name}`}
                          type="text"
                          value={constructorArgs[input.name] ?? ""}
                          onChange={(e) =>
                            handleArgChange(input.name, input.type, e.target.value)
                          }
                          placeholder={
                            input.type.toLowerCase().includes("address")
                              ? "G... or C... (56 characters)"
                              : `Enter ${input.type} value`
                          }
                          className={`w-full bg-slate-950 rounded-lg border px-3 py-2 text-xs font-mono text-slate-200 outline-none transition ${
                            hasError
                              ? "border-rose-500 focus:border-rose-500"
                              : "border-white/10 focus:border-violet-500"
                          }`}
                        />

                        {hasError && (
                          <p
                            data-testid={`validation-error-${input.name}`}
                            className="text-[11px] text-rose-400 font-medium flex items-center gap-1"
                          >
                            <AlertTriangle size={12} />
                            <span>{errorMsg}</span>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* STEP 3: Deposit Estimation & Confirmation */}
          {currentStep === "confirmation" && (
            <div className="space-y-5" data-testid="wizard-step-confirmation">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">
                  Review & Estimated Storage Deposit
                </h3>
                <p className="text-xs text-slate-400">
                  Verify initial ledger footprint deposit and deployment parameters.
                </p>
              </div>

              {/* Deposit Cost Card */}
              <div className="p-4 rounded-xl bg-violet-500/5 border border-violet-500/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-violet-300">
                    <Coins size={16} className="text-amber-400" />
                    <span>Estimated Initial Storage Deposit</span>
                  </div>
                  <div className="text-right">
                    <span
                      data-testid="storage-deposit-stroops"
                      className="font-mono text-sm font-bold text-white"
                    >
                      {estimatedStorageDepositStroops.toLocaleString()} Stroops
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      ≈ {(estimatedStorageDepositStroops / 10000000).toFixed(4)} XLM
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Required to reserve persistent ledger entries for contract bytecode ({Math.ceil(wasmSize / 1024)} KB) and state footprint on {NETWORKS[selectedNetwork].name}.
                </p>
              </div>

              {/* Deployment Summary Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-950/60 border border-white/5 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-500">Target Network</span>
                  <div className="font-semibold text-slate-200 capitalize">
                    {NETWORKS[selectedNetwork].name}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/60 border border-white/5 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-500">Contract Artifact</span>
                  <div className="font-semibold text-slate-200">
                    {contractName} ({Math.ceil(wasmSize / 1024)} KB)
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Deploying state */}
          {currentStep === "deploying" && (
            <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
              <RefreshCw size={36} className="animate-spin text-violet-400" />
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white">
                  Deploying to {NETWORKS[selectedNetwork].name}...
                </h3>
                <p className="text-xs text-slate-400">
                  Broadcasting signed transaction and waiting for ledger consensus.
                </p>
              </div>
            </div>
          )}

          {/* STEP 5: Deployment Complete */}
          {currentStep === "complete" && deploymentResult && (
            <div className="py-6 space-y-5" data-testid="wizard-step-complete">
              <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center space-y-2">
                <CheckCircle2 size={36} className="mx-auto text-emerald-400" />
                <h3 className="text-base font-bold text-emerald-300">
                  Smart Contract Deployed Successfully!
                </h3>
                <p className="text-xs text-slate-300">
                  Contract is live on {NETWORKS[selectedNetwork].name}.
                </p>
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-white/5 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-500">Deployed Contract ID</span>
                  <div
                    data-testid="deployed-contract-id"
                    className="font-mono text-emerald-300 select-all break-all"
                  >
                    {deploymentResult.contractId}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-white/5 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-500">Transaction Hash</span>
                  <div
                    data-testid="deployed-tx-hash"
                    className="font-mono text-slate-300 select-all break-all"
                  >
                    {deploymentResult.txHash}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-white/10 bg-slate-950/80 flex items-center justify-between">
          <div>
            {currentStep === "constructor" && (
              <button
                type="button"
                data-testid="back-btn"
                onClick={() => setCurrentStep("network")}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-semibold transition"
              >
                <ArrowLeft size={14} />
                <span>Back</span>
              </button>
            )}
            {currentStep === "confirmation" && (
              <button
                type="button"
                data-testid="back-btn"
                onClick={() => setCurrentStep("constructor")}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-semibold transition"
              >
                <ArrowLeft size={14} />
                <span>Back</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {currentStep === "network" && (
              <button
                type="button"
                data-testid="proceed-to-args-btn"
                onClick={() => setCurrentStep("constructor")}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition shadow-sm active:scale-95"
              >
                <span>Configure Arguments</span>
                <ArrowRight size={14} />
              </button>
            )}

            {currentStep === "constructor" && (
              <button
                type="button"
                data-testid="proceed-to-confirmation-btn"
                onClick={handleProceedToConfirmation}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition shadow-sm active:scale-95"
              >
                <span>Review & Deposit</span>
                <ArrowRight size={14} />
              </button>
            )}

            {currentStep === "confirmation" && (
              <button
                type="button"
                data-testid="confirm-deploy-btn"
                disabled={isDeploying}
                onClick={handleExecuteDeployment}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-sm active:scale-95 disabled:opacity-50"
              >
                <Rocket size={14} />
                <span>Confirm & Broadcast</span>
              </button>
            )}

            {currentStep === "complete" && (
              <button
                type="button"
                data-testid="complete-close-btn"
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
