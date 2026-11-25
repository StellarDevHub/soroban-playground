"use client";

import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Coins,
  Globe,
  Rocket,
  ShieldCheck,
  Sliders,
} from "lucide-react";
import {
  NETWORKS,
  NETWORK_PRESETS,
  type NetworkConfig,
  type NetworkId,
} from "./NetworkSwitcher";
import {
  buildAbiArguments,
  buildDefaultInputValue,
  normalizeType,
  parseContractAbiFromSource,
  validateSorobanType,
  type ContractAbiFunction,
  type ContractAbiFunctionInput,
} from "../utils/contractAbi";

export type WizardStep = "network" | "parameters" | "review";

export interface StorageDepositEstimate {
  baseFeeStroops: number;
  wasmStorageStroops: number;
  instanceStorageStroops: number;
  totalStroops: number;
  totalXlm: string;
}

export interface DeploymentTransaction {
  networkId: NetworkId;
  networkName: string;
  rpcUrl: string;
  networkPassphrase: string;
  constructorName: string | null;
  constructorArgs: Record<string, unknown>;
  estimatedStorageDepositStroops: number;
  wasmByteLength: number;
  wasmHash?: string;
  createdAt: string;
}

export interface DeploymentWizardProps {
  abi?: ContractAbiFunction[];
  contractSource?: string;
  wasmByteLength?: number;
  wasmHash?: string;
  initialNetwork?: NetworkId;
  onDeploy?: (
    tx: DeploymentTransaction,
  ) => Promise<{ contractId?: string; txHash?: string } | void> | void;
  onCancel?: () => void;
}

const STROOPS_PER_XLM = 10_000_000;
const BASE_INCLUSION_FEE_STROOPS = 100;
const BASE_CONTRACT_INSTANCE_DEPOSIT_STROOPS = 50_000;
const STROOPS_PER_WASM_BYTE = 12;
const STROOPS_PER_INIT_ARG_BYTE = 25;

const CONSTRUCTOR_NAMES = new Set([
  "__constructor",
  "initialize",
  "init",
  "constructor",
]);

const INTEGER_BOUNDS: Record<string, { min: bigint; max: bigint }> = {
  u8: { min: 0n, max: 255n },
  u16: { min: 0n, max: 65535n },
  u32: { min: 0n, max: 4294967295n },
  u64: { min: 0n, max: (1n << 64n) - 1n },
  u128: { min: 0n, max: (1n << 128n) - 1n },
  u256: { min: 0n, max: (1n << 256n) - 1n },
  i8: { min: -128n, max: 127n },
  i16: { min: -32768n, max: 32767n },
  i32: { min: -2147483648n, max: 2147483647n },
  i64: { min: -(1n << 63n), max: (1n << 63n) - 1n },
  i128: { min: -(1n << 127n), max: (1n << 127n) - 1n },
  i256: { min: -(1n << 255n), max: (1n << 255n) - 1n },
};

export function findConstructorFunction(
  abi: ContractAbiFunction[],
): ContractAbiFunction | null {
  if (!abi || abi.length === 0) return null;
  return (
    abi.find((fn) => CONSTRUCTOR_NAMES.has(fn.name.toLowerCase())) ?? null
  );
}

export function validateConstructorParam(
  input: ContractAbiFunctionInput,
  value: unknown,
): string | null {
  const rawType = input.type.trim().toLowerCase();
  const bounds = INTEGER_BOUNDS[rawType];

  if (bounds) {
    if (value === undefined || value === null || String(value).trim() === "") {
      return `Field '${input.name}' (${input.type}) is required.`;
    }
    const str = String(value).trim();
    if (!/^-?\d+$/.test(str)) {
      return `Field '${input.name}' must be a valid ${input.type} integer.`;
    }
    const parsed = BigInt(str);
    if (parsed < bounds.min || parsed > bounds.max) {
      return `Field '${input.name}' overflows ${input.type} range (${bounds.min.toString()} to ${bounds.max.toString()}).`;
    }
    return null;
  }

  const kind = normalizeType(input.type);
  if (kind === "bool") {
    if (typeof value !== "boolean" && value !== "true" && value !== "false") {
      return `Field '${input.name}' must be a boolean value.`;
    }
    return null;
  }

  return validateSorobanType(input.name, input.type, value);
}

export function validateConstructorArguments(
  constructorFn: ContractAbiFunction | null,
  values: Record<string, unknown>,
): Record<string, string> {
  if (!constructorFn) return {};

  const errors: Record<string, string> = {};
  for (const input of constructorFn.inputs ?? []) {
    const error = validateConstructorParam(input, values[input.name]);
    if (error) {
      errors[input.name] = error;
    }
  }
  return errors;
}

export function estimateStorageDepositStroops(
  wasmByteLength: number,
  initArgs: Record<string, unknown>,
): StorageDepositEstimate {
  const safeWasmBytes = Math.max(0, Math.floor(wasmByteLength));
  const serializedArgsBytes = new TextEncoder().encode(
    JSON.stringify(initArgs ?? {}),
  ).length;

  const baseFeeStroops = BASE_INCLUSION_FEE_STROOPS;
  const wasmStorageStroops = safeWasmBytes * STROOPS_PER_WASM_BYTE;
  const instanceStorageStroops =
    BASE_CONTRACT_INSTANCE_DEPOSIT_STROOPS +
    serializedArgsBytes * STROOPS_PER_INIT_ARG_BYTE;
  const totalStroops =
    baseFeeStroops + wasmStorageStroops + instanceStorageStroops;

  return {
    baseFeeStroops,
    wasmStorageStroops,
    instanceStorageStroops,
    totalStroops,
    totalXlm: (totalStroops / STROOPS_PER_XLM).toFixed(7),
  };
}

export function createDeploymentTransaction(params: {
  networkId: NetworkId;
  constructorFn: ContractAbiFunction | null;
  rawValues: Record<string, unknown>;
  wasmByteLength: number;
  wasmHash?: string;
}): { transaction?: DeploymentTransaction; errors: Record<string, string> } {
  const errors = validateConstructorArguments(
    params.constructorFn,
    params.rawValues,
  );
  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const network: NetworkConfig = NETWORKS[params.networkId] ?? NETWORKS.testnet;
  const constructorArgs = buildAbiArguments(
    params.constructorFn,
    params.rawValues,
  );
  const estimate = estimateStorageDepositStroops(
    params.wasmByteLength,
    constructorArgs,
  );

  return {
    errors: {},
    transaction: {
      networkId: network.id,
      networkName: network.name,
      rpcUrl: network.rpcUrl,
      networkPassphrase: network.passphrase,
      constructorName: params.constructorFn?.name ?? null,
      constructorArgs,
      estimatedStorageDepositStroops: estimate.totalStroops,
      wasmByteLength: params.wasmByteLength,
      ...(params.wasmHash ? { wasmHash: params.wasmHash } : {}),
      createdAt: new Date().toISOString(),
    },
  };
}

const STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: "network", label: "1. Network" },
  { id: "parameters", label: "2. Constructor Args" },
  { id: "review", label: "3. Review & Deploy" },
];

export default function DeploymentWizard({
  abi,
  contractSource,
  wasmByteLength = 16_384,
  wasmHash,
  initialNetwork = "testnet",
  onDeploy,
  onCancel,
}: DeploymentWizardProps) {
  const parsedAbi = useMemo(() => {
    if (abi && abi.length > 0) return abi;
    if (contractSource) return parseContractAbiFromSource(contractSource);
    return [];
  }, [abi, contractSource]);

  const constructorFn = useMemo(
    () => findConstructorFunction(parsedAbi),
    [parsedAbi],
  );

  const [step, setStep] = useState<WizardStep>("network");
  const [selectedNetworkId, setSelectedNetworkId] =
    useState<NetworkId>(initialNetwork);
  const [argValues, setArgValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const input of constructorFn?.inputs ?? []) {
      const def = buildDefaultInputValue(input.type);
      initial[input.name] =
        typeof def === "object" && def !== null ? JSON.stringify(def) : def;
    }
    return initial;
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deployResult, setDeployResult] = useState<{
    contractId?: string;
    txHash?: string;
    transaction: DeploymentTransaction;
  } | null>(null);

  const selectedNetwork = NETWORKS[selectedNetworkId] ?? NETWORKS.testnet;

  const normalizedArgs = useMemo(
    () => buildAbiArguments(constructorFn, argValues),
    [constructorFn, argValues],
  );

  const storageEstimate = useMemo(
    () => estimateStorageDepositStroops(wasmByteLength, normalizedArgs),
    [wasmByteLength, normalizedArgs],
  );

  const handleParamChange = (input: ContractAbiFunctionInput, value: unknown) => {
    const nextValues = { ...argValues, [input.name]: value };
    setArgValues(nextValues);

    const err = validateConstructorParam(input, value);
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (err) {
        next[input.name] = err;
      } else {
        delete next[input.name];
      }
      return next;
    });
  };

  const handleNextFromParameters = () => {
    const errors = validateConstructorArguments(constructorFn, argValues);
    setFieldErrors(errors);
    if (Object.keys(errors).length === 0) {
      setStep("review");
    }
  };

  const handleConfirmDeploy = async () => {
    setSubmitError(null);
    const { transaction, errors } = createDeploymentTransaction({
      networkId: selectedNetworkId,
      constructorFn,
      rawValues: argValues,
      wasmByteLength,
      wasmHash,
    });

    if (!transaction || Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setStep("parameters");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await onDeploy?.(transaction);
      setDeployResult({
        contractId: result?.contractId,
        txHash: result?.txHash,
        transaction,
      });
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Deployment transaction failed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="flex flex-col space-y-5 p-6 bg-slate-950 border border-slate-800 rounded-2xl shadow-xl text-slate-100"
      data-testid="deployment-wizard"
    >
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2.5">
          <Rocket size={18} className="text-teal-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
            Contract Deployment Wizard
          </h2>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Step Indicator */}
      <ol
        className="grid grid-cols-3 gap-2"
        aria-label="Deployment wizard steps"
      >
        {STEPS.map((s) => {
          const isActive = s.id === step;
          const stepIndex = STEPS.findIndex((item) => item.id === s.id);
          const currentIndex = STEPS.findIndex((item) => item.id === step);
          const isCompleted = stepIndex < currentIndex || Boolean(deployResult);

          return (
            <li
              key={s.id}
              aria-current={isActive ? "step" : undefined}
              className={`px-3 py-2 rounded-xl text-xs font-medium border text-center transition-colors ${
                isActive
                  ? "bg-teal-500/15 border-teal-500/50 text-teal-200"
                  : isCompleted
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : "bg-slate-900 border-slate-800 text-slate-500"
              }`}
            >
              {s.label}
            </li>
          );
        })}
      </ol>

      {/* Step 1: Network Presets */}
      {step === "network" && (
        <div className="space-y-4" data-testid="wizard-step-network">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Globe size={14} className="text-teal-400" />
            <span>Select Target Stellar Soroban Network</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {NETWORK_PRESETS.map((preset) => {
              const isSelected = preset.id === selectedNetworkId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedNetworkId(preset.id)}
                  data-testid={`network-preset-${preset.id}`}
                  aria-pressed={isSelected}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? "bg-teal-500/15 border-teal-400 text-white"
                      : "bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider">
                      {preset.name}
                    </span>
                    {preset.id === "mainnet" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        Live
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] font-mono text-slate-400 truncate">
                    {preset.rpcUrl}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-500 truncate">
                    {preset.passphrase}
                  </p>
                </button>
              );
            })}
          </div>

          {selectedNetworkId === "mainnet" && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>
                Mainnet deployments spend real XLM for fees and storage
                deposits. Double-check all parameters before confirming.
              </span>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setStep("parameters")}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold transition-colors"
            >
              <span>Next: Constructor Parameters</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Constructor & Initialization Parameters */}
      {step === "parameters" && (
        <div className="space-y-4" data-testid="wizard-step-parameters">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Sliders size={14} className="text-teal-400" />
              <span>
                {constructorFn
                  ? `Initialization Function: ${constructorFn.name}()`
                  : "No Constructor / Initialization Parameters"}
              </span>
            </div>
            <span className="text-[11px] text-slate-500">
              Client-side ABI validation active
            </span>
          </div>

          {!constructorFn || (constructorFn.inputs ?? []).length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
              This contract does not require constructor or initialization
              arguments. You can proceed directly to review.
            </div>
          ) : (
            <div className="space-y-3">
              {(constructorFn.inputs ?? []).map((input) => {
                const kind = normalizeType(input.type);
                const value = argValues[input.name];
                const error = fieldErrors[input.name];

                return (
                  <div key={input.name} className="space-y-1">
                    <label
                      htmlFor={`wizard-param-${input.name}`}
                      className="flex items-center justify-between text-xs font-medium text-slate-300"
                    >
                      <span>{input.name}</span>
                      <span className="font-mono text-[11px] text-teal-400">
                        {input.type}
                      </span>
                    </label>

                    {kind === "bool" ? (
                      <input
                        id={`wizard-param-${input.name}`}
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(e) =>
                          handleParamChange(input, e.target.checked)
                        }
                        className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-teal-500"
                      />
                    ) : (
                      <input
                        id={`wizard-param-${input.name}`}
                        type="text"
                        value={value === undefined || value === null ? "" : String(value)}
                        onChange={(e) =>
                          handleParamChange(input, e.target.value)
                        }
                        placeholder={`Enter ${input.type} value`}
                        aria-invalid={Boolean(error)}
                        className={`w-full px-3 py-2 rounded-xl bg-slate-900 border text-xs font-mono text-slate-100 focus:outline-none ${
                          error
                            ? "border-rose-500 focus:border-rose-400"
                            : "border-slate-700 focus:border-teal-500"
                        }`}
                      />
                    )}

                    {error && (
                      <p
                        role="alert"
                        className="flex items-center gap-1.5 text-[11px] text-rose-400"
                      >
                        <AlertCircle size={12} className="shrink-0" />
                        <span>{error}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep("network")}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium transition-colors"
            >
              <ArrowLeft size={14} />
              <span>Back</span>
            </button>
            <button
              type="button"
              onClick={handleNextFromParameters}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold transition-colors"
            >
              <span>Next: Review & Estimate</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review, Storage Deposit Estimate & Confirmation */}
      {step === "review" && (
        <div className="space-y-4" data-testid="wizard-step-review">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-slate-300 font-semibold">
              <ShieldCheck size={14} className="text-teal-400" />
              <span>Deployment Summary</span>
            </div>
            <div className="grid grid-cols-2 gap-y-1.5 text-[11px]">
              <span className="text-slate-500">Target Network</span>
              <span className="text-slate-200 font-medium text-right">
                {selectedNetwork.name}
              </span>
              <span className="text-slate-500">RPC Endpoint</span>
              <span className="text-slate-300 font-mono text-right truncate">
                {selectedNetwork.rpcUrl}
              </span>
              <span className="text-slate-500">Network Passphrase</span>
              <span className="text-slate-300 font-mono text-right truncate">
                {selectedNetwork.passphrase}
              </span>
              {constructorFn && (
                <>
                  <span className="text-slate-500">Constructor</span>
                  <span className="text-teal-300 font-mono text-right">
                    {constructorFn.name}()
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Estimated Initial Storage Deposit in Stroops */}
          <div
            className="p-4 rounded-xl bg-slate-900 border border-teal-500/30 space-y-2 text-xs"
            data-testid="storage-deposit-estimate"
          >
            <div className="flex items-center gap-2 text-teal-300 font-semibold">
              <Coins size={14} />
              <span>Estimated Initial Storage Deposit</span>
            </div>
            <div className="grid grid-cols-2 gap-y-1 text-[11px]">
              <span className="text-slate-400">Base Inclusion Fee</span>
              <span className="font-mono text-right text-slate-300">
                {storageEstimate.baseFeeStroops.toLocaleString()} Stroops
              </span>
              <span className="text-slate-400">
                Wasm Storage ({wasmByteLength.toLocaleString()} bytes)
              </span>
              <span className="font-mono text-right text-slate-300">
                {storageEstimate.wasmStorageStroops.toLocaleString()} Stroops
              </span>
              <span className="text-slate-400">Instance & Init Storage</span>
              <span className="font-mono text-right text-slate-300">
                {storageEstimate.instanceStorageStroops.toLocaleString()} Stroops
              </span>
              <span className="text-slate-200 font-semibold pt-1 border-t border-slate-800">
                Total Estimated Deposit
              </span>
              <span
                className="font-mono font-semibold text-right text-teal-300 pt-1 border-t border-slate-800"
                data-testid="total-stroops-value"
              >
                {storageEstimate.totalStroops.toLocaleString()} Stroops (
                {storageEstimate.totalXlm} XLM)
              </span>
            </div>
          </div>

          {submitError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-200 text-xs"
            >
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {deployResult && (
            <div
              className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-200 text-xs"
              data-testid="deployment-success"
            >
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-semibold">
                  Deployment transaction created for{" "}
                  {deployResult.transaction.networkName}.
                </p>
                {deployResult.contractId && (
                  <p className="font-mono text-[11px]">
                    Contract ID: {deployResult.contractId}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep("parameters")}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium transition-colors disabled:opacity-50"
            >
              <ArrowLeft size={14} />
              <span>Back</span>
            </button>
            <button
              type="button"
              onClick={handleConfirmDeploy}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <Rocket size={14} />
              <span>
                {isSubmitting
                  ? "Deploying..."
                  : `Confirm & Deploy to ${selectedNetwork.name}`}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
