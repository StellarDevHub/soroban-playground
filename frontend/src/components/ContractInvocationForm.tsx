"use client";

import React, { useState, useCallback, useMemo } from "react";
import {
  type ContractAbiFunction,
  type ContractAbiFunctionInput,
  validateSorobanType,
  serializeValueToScVal,
  normalizeType,
  extractInnerType,
  extractMapTypes,
  buildDefaultInputValue,
} from "@/utils/contractAbi";
import {
  Play,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Shield,
  Coins,
  Binary,
  Layers,
  HelpCircle,
} from "lucide-react";

export interface ContractInvocationFormProps {
  abiFunction: ContractAbiFunction;
  onInvoke?: (
    functionName: string,
    args: Record<string, unknown>,
    scValPayload: Record<string, unknown>
  ) => void;
  isInvoking?: boolean;
  className?: string;
}

export const ContractInvocationForm: React.FC<ContractInvocationFormProps> = ({
  abiFunction,
  onInvoke,
  isInvoking = false,
  className = "",
}) => {
  // Initialize form values from inputs
  const initialValues = useMemo(() => {
    const vals: Record<string, unknown> = {};
    for (const input of abiFunction.inputs ?? []) {
      vals[input.name] = buildDefaultInputValue(input.type);
    }
    return vals;
  }, [abiFunction]);

  const [formValues, setFormValues] = useState<Record<string, unknown>>(initialValues);
  const [optionalToggles, setOptionalToggles] = useState<Record<string, boolean>>({});

  const handleFieldChange = useCallback((name: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleOptionalToggle = useCallback(
    (name: string, innerType: string) => {
      setOptionalToggles((prev) => {
        const nextState = !prev[name];
        setFormValues((curr) => ({
          ...curr,
          [name]: nextState ? buildDefaultInputValue(innerType) : null,
        }));
        return { ...prev, [name]: nextState };
      });
    },
    []
  );

  // Vector helpers
  const handleAddVecItem = useCallback((paramName: string, innerType: string) => {
    setFormValues((prev) => {
      const currentList = Array.isArray(prev[paramName]) ? [...(prev[paramName] as unknown[])] : [];
      currentList.push(buildDefaultInputValue(innerType));
      return { ...prev, [paramName]: currentList };
    });
  }, []);

  const handleRemoveVecItem = useCallback((paramName: string, index: number) => {
    setFormValues((prev) => {
      const currentList = Array.isArray(prev[paramName]) ? [...(prev[paramName] as unknown[])] : [];
      currentList.splice(index, 1);
      return { ...prev, [paramName]: currentList };
    });
  }, []);

  const handleVecItemChange = useCallback((paramName: string, index: number, value: unknown) => {
    setFormValues((prev) => {
      const currentList = Array.isArray(prev[paramName]) ? [...(prev[paramName] as unknown[])] : [];
      currentList[index] = value;
      return { ...prev, [paramName]: currentList };
    });
  }, []);

  // Map helpers
  const handleAddMapEntry = useCallback((paramName: string, keyType: string, valType: string) => {
    setFormValues((prev) => {
      const currentMap =
        typeof prev[paramName] === "object" && prev[paramName] !== null
          ? { ...(prev[paramName] as Record<string, unknown>) }
          : {};
      const newKey = `key_${Object.keys(currentMap).length + 1}`;
      currentMap[newKey] = buildDefaultInputValue(valType);
      return { ...prev, [paramName]: currentMap };
    });
  }, []);

  const handleRemoveMapEntry = useCallback((paramName: string, key: string) => {
    setFormValues((prev) => {
      const currentMap =
        typeof prev[paramName] === "object" && prev[paramName] !== null
          ? { ...(prev[paramName] as Record<string, unknown>) }
          : {};
      delete currentMap[key];
      return { ...prev, [paramName]: currentMap };
    });
  }, []);

  const handleMapEntryChange = useCallback((paramName: string, oldKey: string, newKey: string, newVal: unknown) => {
    setFormValues((prev) => {
      const currentMap =
        typeof prev[paramName] === "object" && prev[paramName] !== null
          ? { ...(prev[paramName] as Record<string, unknown>) }
          : {};
      if (oldKey !== newKey) {
        delete currentMap[oldKey];
      }
      currentMap[newKey] = newVal;
      return { ...prev, [paramName]: currentMap };
    });
  }, []);

  // Compute validation errors across all inputs
  const validationErrors = useMemo(() => {
    const errors: Record<string, string | null> = {};
    for (const input of abiFunction.inputs ?? []) {
      const kind = normalizeType(input.type);
      if (kind === "option" && !optionalToggles[input.name]) {
        errors[input.name] = null; // Skipped optional
      } else {
        errors[input.name] = validateSorobanType(input.name, input.type, formValues[input.name]);
      }
    }
    return errors;
  }, [abiFunction.inputs, formValues, optionalToggles]);

  const hasErrors = Object.values(validationErrors).some((err) => Boolean(err));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasErrors || isInvoking) return;

    const scValPayload: Record<string, unknown> = {};
    for (const input of abiFunction.inputs ?? []) {
      scValPayload[input.name] = serializeValueToScVal(input.type, formValues[input.name]);
    }

    onInvoke?.(abiFunction.name, formValues, scValPayload);
  };

  const renderBadge = (kind: string) => {
    switch (kind) {
      case "address":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-teal-950/80 text-teal-300 border border-teal-800">
            <Shield className="w-3 h-3" /> Stellar Address
          </span>
        );
      case "stroops":
      case "u128":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-amber-950/80 text-amber-300 border border-amber-800">
            <Coins className="w-3 h-3" /> Stroops / Integer
          </span>
        );
      case "bytes":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-purple-950/80 text-purple-300 border border-purple-800">
            <Binary className="w-3 h-3" /> Hex Bytes
          </span>
        );
      case "vec":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-blue-950/80 text-blue-300 border border-blue-800">
            <Layers className="w-3 h-3" /> Vector
          </span>
        );
      default:
        return null;
    }
  };

  const renderInputField = (input: ContractAbiFunctionInput) => {
    const kind = normalizeType(input.type);
    const value = formValues[input.name];
    const error = validationErrors[input.name];

    // 1. OPTIONAL FIELD
    if (kind === "option") {
      const inner = extractInnerType(input.type);
      const isEnabled = Boolean(optionalToggles[input.name]);

      return (
        <div key={input.name} className="flex flex-col gap-2 p-3 rounded-lg border border-gray-800 bg-gray-900/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-medium text-slate-200">{input.name}</span>
              <span className="text-[10px] font-mono text-gray-500 bg-gray-800/80 px-1.5 py-0.5 rounded">Option&lt;{inner}&gt;</span>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                data-testid={`toggle-optional-${input.name}`}
                checked={isEnabled}
                onChange={() => handleOptionalToggle(input.name, inner)}
                className="w-3.5 h-3.5 rounded bg-gray-800 border-gray-700 text-teal-500 focus:ring-0"
              />
              <span>Provide optional value</span>
            </label>
          </div>

          {isEnabled && (
            <div className="mt-2 pl-2 border-l-2 border-teal-500/40">
              <input
                type="text"
                data-testid={`input-${input.name}`}
                value={typeof value === "string" || typeof value === "number" ? value : ""}
                onChange={(e) => handleFieldChange(input.name, e.target.value)}
                placeholder={`Optional ${inner} value...`}
                className={`w-full px-3 py-1.5 text-xs font-mono rounded bg-gray-950 border transition-colors ${
                  error ? "border-rose-500 text-rose-200" : "border-gray-800 text-slate-200 focus:border-teal-500"
                }`}
              />
              {error && <span className="text-[11px] text-rose-400 mt-1 block">{error}</span>}
            </div>
          )}
        </div>
      );
    }

    // 2. VECTOR FIELD
    if (kind === "vec") {
      const inner = extractInnerType(input.type);
      const items = Array.isArray(value) ? value : [];

      return (
        <div key={input.name} className="flex flex-col gap-2 p-3 rounded-lg border border-gray-800 bg-gray-900/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-medium text-slate-200">{input.name}</span>
              {renderBadge(kind)}
            </div>
            <button
              type="button"
              data-testid={`add-vec-item-${input.name}`}
              onClick={() => handleAddVecItem(input.name, inner)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-gray-800 hover:bg-gray-700 text-teal-400 transition-colors"
            >
              <Plus className="w-3 h-3" /> Add Item
            </button>
          </div>

          <div className="flex flex-col gap-2 mt-1">
            {items.length === 0 ? (
              <span className="text-xs text-gray-500 italic py-1">No items added yet. Click &quot;Add Item&quot; to append.</span>
            ) : (
              items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-gray-500 w-6">#{idx}</span>
                  <input
                    type="text"
                    data-testid={`vec-item-${input.name}-${idx}`}
                    value={typeof item === "string" || typeof item === "number" ? item : ""}
                    onChange={(e) => handleVecItemChange(input.name, idx, e.target.value)}
                    placeholder={`${inner} item...`}
                    className="flex-1 px-2.5 py-1 text-xs font-mono rounded bg-gray-950 border border-gray-800 text-slate-200 focus:border-teal-500"
                  />
                  <button
                    type="button"
                    data-testid={`remove-vec-item-${input.name}-${idx}`}
                    onClick={() => handleRemoveVecItem(input.name, idx)}
                    className="p-1 rounded text-gray-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                    title="Remove item"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
          {error && <span className="text-[11px] text-rose-400 mt-1 block">{error}</span>}
        </div>
      );
    }

    // 3. MAP FIELD
    if (kind === "map") {
      const { keyType, valueType } = extractMapTypes(input.type);
      const mapObj = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
      const entries = Object.entries(mapObj);

      return (
        <div key={input.name} className="flex flex-col gap-2 p-3 rounded-lg border border-gray-800 bg-gray-900/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-medium text-slate-200">{input.name}</span>
              <span className="text-[10px] font-mono text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                Map&lt;{keyType}, {valueType}&gt;
              </span>
            </div>
            <button
              type="button"
              data-testid={`add-map-entry-${input.name}`}
              onClick={() => handleAddMapEntry(input.name, keyType, valueType)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-gray-800 hover:bg-gray-700 text-teal-400 transition-colors"
            >
              <Plus className="w-3 h-3" /> Add Pair
            </button>
          </div>

          <div className="flex flex-col gap-2 mt-1">
            {entries.length === 0 ? (
              <span className="text-xs text-gray-500 italic py-1">Map is empty. Click &quot;Add Pair&quot; to insert an entry.</span>
            ) : (
              entries.map(([k, v], idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    data-testid={`map-key-${input.name}-${idx}`}
                    value={k}
                    onChange={(e) => handleMapEntryChange(input.name, k, e.target.value, v)}
                    placeholder={`Key (${keyType})...`}
                    className="w-1/3 px-2.5 py-1 text-xs font-mono rounded bg-gray-950 border border-gray-800 text-teal-300 focus:border-teal-500"
                  />
                  <span className="text-gray-600">:</span>
                  <input
                    type="text"
                    data-testid={`map-val-${input.name}-${idx}`}
                    value={typeof v === "string" || typeof v === "number" ? v : ""}
                    onChange={(e) => handleMapEntryChange(input.name, k, k, e.target.value)}
                    placeholder={`Value (${valueType})...`}
                    className="flex-1 px-2.5 py-1 text-xs font-mono rounded bg-gray-950 border border-gray-800 text-slate-200 focus:border-teal-500"
                  />
                  <button
                    type="button"
                    data-testid={`remove-map-entry-${input.name}-${idx}`}
                    onClick={() => handleRemoveMapEntry(input.name, k)}
                    className="p-1 rounded text-gray-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                    title="Remove entry"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
          {error && <span className="text-[11px] text-rose-400 mt-1 block">{error}</span>}
        </div>
      );
    }

    // 4. BOOLEAN FIELD
    if (kind === "bool") {
      return (
        <div key={input.name} className="flex items-center justify-between p-3 rounded-lg border border-gray-800 bg-gray-900/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-medium text-slate-200">{input.name}</span>
            <span className="text-[10px] font-mono text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">bool</span>
          </div>
          <select
            data-testid={`input-${input.name}`}
            value={String(value)}
            onChange={(e) => handleFieldChange(input.name, e.target.value === "true")}
            className="px-3 py-1 text-xs font-mono rounded bg-gray-950 border border-gray-800 text-slate-200 focus:border-teal-500"
          >
            <option value="false">false</option>
            <option value="true">true</option>
          </select>
        </div>
      );
    }

    // 5. STANDARD PRIMITIVES (address, symbol, stroops, u128, bytes, number, string)
    return (
      <div key={input.name} className="flex flex-col gap-1.5 p-3 rounded-lg border border-gray-800 bg-gray-900/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-medium text-slate-200">{input.name}</span>
            <span className="text-[10px] font-mono text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">{input.type}</span>
            {renderBadge(kind)}
          </div>
          {input.doc && (
            <span className="text-[11px] text-gray-500 truncate max-w-[200px]" title={input.doc}>
              {input.doc}
            </span>
          )}
        </div>

        <input
          type="text"
          data-testid={`input-${input.name}`}
          value={typeof value === "string" || typeof value === "number" ? value : ""}
          onChange={(e) => handleFieldChange(input.name, e.target.value)}
          placeholder={
            kind === "address"
              ? "G... or C... (56 chars)"
              : kind === "bytes"
              ? "0x1234abcd..."
              : kind === "stroops"
              ? "Amount in Stroops (e.g. 10000000)"
              : `Enter ${input.type} value...`
          }
          className={`w-full px-3 py-1.5 text-xs font-mono rounded bg-gray-950 border transition-colors ${
            error ? "border-rose-500 text-rose-200" : "border-gray-800 text-slate-200 focus:border-teal-500"
          }`}
        />

        {error ? (
          <div className="flex items-center gap-1.5 text-[11px] text-rose-400 mt-0.5">
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-[10px] text-gray-500 mt-0.5">
            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
            <span>
              {kind === "address"
                ? "Valid Stellar Public or Contract Key format"
                : kind === "bytes"
                ? "Valid hexadecimal byte array"
                : kind === "stroops"
                ? "1 XLM = 10,000,000 Stroops"
                : "Valid Soroban specification"}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <form
      data-testid="contract-invocation-form"
      role="form"
      onSubmit={handleSubmit}
      className={`flex flex-col gap-4 bg-gray-950 border border-gray-800 rounded-xl p-5 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-gray-800">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono font-bold text-teal-400">{abiFunction.name}</span>
            <span className="text-xs text-gray-500 font-mono">(Invocation)</span>
          </div>
          {abiFunction.doc && <p className="text-xs text-gray-400">{abiFunction.doc}</p>}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-gray-500">
            {abiFunction.inputs?.length ?? 0} argument(s)
          </span>
        </div>
      </div>

      {/* Inputs List */}
      <div className="flex flex-col gap-3">
        {(abiFunction.inputs ?? []).length === 0 ? (
          <div className="flex items-center gap-2 p-3 text-xs text-gray-500 bg-gray-900/40 rounded-lg">
            <HelpCircle className="w-4 h-4 text-gray-400" />
            <span>This contract function takes no parameters. Ready to invoke immediately.</span>
          </div>
        ) : (
          (abiFunction.inputs ?? []).map(renderInputField)
        )}
      </div>

      {/* Action / Submit */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-800">
        {hasErrors ? (
          <span className="text-xs text-rose-400 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" /> Please correct validation errors above before invoking.
          </span>
        ) : (
          <span className="text-xs text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> All parameters conform to Soroban contract spec.
          </span>
        )}

        <button
          type="submit"
          data-testid="invoke-contract-btn"
          disabled={hasErrors || isInvoking}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-xs font-semibold shadow-md transition-all ${
            hasErrors || isInvoking
              ? "bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700"
              : "bg-teal-500 hover:bg-teal-400 text-gray-950 border border-teal-400 hover:shadow-teal-500/20"
          }`}
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>{isInvoking ? "Simulating On-Chain..." : `Invoke ${abiFunction.name}`}</span>
        </button>
      </div>
    </form>
  );
};

export default ContractInvocationForm;
