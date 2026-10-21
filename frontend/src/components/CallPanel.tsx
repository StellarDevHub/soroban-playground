"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Send, Code2, AlertCircle } from "lucide-react";
import {
  buildAbiArguments,
  buildDefaultInputValue,
  validateAbiArguments,
  type ContractAbiFunction,
} from "@/utils/contractAbi";
import WasmSpecFormBuilder from "./WasmSpecFormBuilder";
import AbiViewer from "./AbiViewer";

interface CallPanelProps {
  onInvoke: (func: string, args: Record<string, unknown>) => void;
  isInvoking: boolean;
  contractId?: string;
  abi?: ContractAbiFunction[];
  prefill?: { functionName: string; args: Record<string, unknown> } | null;
}

export default function CallPanel({
  onInvoke,
  isInvoking,
  contractId,
  abi,
  prefill,
}: CallPanelProps) {
  const [funcName, setFuncName] = useState("");
  const [argsRaw, setArgsRaw] = useState("");
  const [parseError, setParseError] = useState("");
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    setParseError("");
  }, [argsRaw, funcName, contractId]);

  useEffect(() => {
    if (!contractId) {
      setFuncName("");
      setArgsRaw("");
      setParseError("");
      setFormValues({});
      return;
    }

    if (abi?.length && !funcName) {
      setFuncName(abi[0].name);
    }
  }, [abi, contractId, funcName]);

  useEffect(() => {
    if (!contractId) {
      return;
    }

    const trimmedName = funcName.trim();
    const selectedAbi =
      abi?.find((entry) => entry.name === trimmedName) ?? null;

    if (!selectedAbi) {
      setFormValues({});
      return;
    }

    const nextValues = (selectedAbi.inputs ?? []).reduce<
      Record<string, unknown>
    >((values, input) => {
      values[input.name] = buildDefaultInputValue(input.type);
      return values;
    }, {});

    setFormValues(nextValues);
  }, [abi, contractId, funcName]);

  useEffect(() => {
    if (!prefill) return;
    setFuncName(prefill.functionName);
    setArgsRaw(JSON.stringify(prefill.args, null, 2));
    setFormValues(prefill.args);
    setParseError("");
  }, [prefill]);

  const parsedArgs = useMemo(() => {
    const trimmed = argsRaw.trim();
    if (!trimmed) {
      return { value: {} as Record<string, unknown>, error: "" };
    }

    try {
      const value = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return {
          value: {} as Record<string, unknown>,
          error: "Arguments must be a JSON object.",
        };
      }

      return { value, error: "" };
    } catch {
      return {
        value: {} as Record<string, unknown>,
        error: "Arguments must be valid JSON.",
      };
    }
  }, [argsRaw]);

  const abiFunction = useMemo(() => {
    const trimmedName = funcName.trim();
    return abi?.find((entry) => entry.name === trimmedName) ?? null;
  }, [abi, funcName]);

  const abiValidationError = useMemo(
    () => validateAbiArguments(abiFunction, formValues),
    [abiFunction, formValues],
  );
  const canInvoke =
    Boolean(contractId && funcName.trim()) &&
    !parseError &&
    (!abiFunction ? !parsedArgs.error : !abiValidationError);

  const handleFieldChange = useCallback((name: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleInvoke = useCallback(() => {
    if (!contractId) {
      setParseError("Deploy a contract before invoking a function.");
      return;
    }

    const trimmedName = funcName.trim();
    if (!trimmedName) {
      setParseError("Function name is required.");
      return;
    }

    if (abiFunction) {
      const validationError = validateAbiArguments(abiFunction, formValues);
      if (validationError) {
        setParseError(validationError);
        return;
      }

      onInvoke(trimmedName, buildAbiArguments(abiFunction, formValues));
      return;
    }

    if (parsedArgs.error) {
      setParseError(parsedArgs.error);
      return;
    }

    onInvoke(trimmedName, parsedArgs.value);
  }, [
    contractId,
    funcName,
    abiFunction,
    formValues,
    onInvoke,
    parsedArgs.error,
    parsedArgs.value,
  ]);

  return (
    <div className="flex flex-col space-y-4 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg mt-4">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center mb-2">
        <Code2 size={16} className="mr-2 text-cyan-400" />
        Interact with Contract
      </h3>

      {!contractId ? (
        <p className="text-xs text-gray-500 italic">
          Deploy a contract to enable interactions.
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <label
              htmlFor="call-panel-function-name"
              className="block text-xs font-semibold text-gray-400 mb-1.5 tracking-wide"
            >
              Function Name
            </label>
            {abi?.length ? (
              <select
                id="call-panel-function-name"
                value={funcName}
                onChange={(event) => setFuncName(event.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg py-2.5 px-3 text-sm text-gray-200 focus:outline-none focus:border-cyan-500 font-mono"
              >
                <option value="">Select a contract function</option>
                {abi.map((entry) => (
                  <option key={entry.name} value={entry.name}>
                    {entry.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="call-panel-function-name"
                type="text"
                value={funcName}
                onChange={(event) => setFuncName(event.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg py-2.5 px-3 text-sm text-gray-200 focus:outline-none focus:border-cyan-500 font-mono"
                placeholder="e.g. hello"
              />
            )}
          </div>

          {abiFunction && (
            <AbiViewer
              abiFunction={abiFunction}
              values={formValues}
              onFieldChange={handleFieldChange}
            />
          )}

          {!abiFunction && (
            <div>
              <label
                htmlFor="call-panel-arguments"
                className="mb-1 block text-xs tracking-wide text-gray-400"
              >
                Arguments (JSON)
              </label>
              <textarea
                id="call-panel-arguments"
                value={argsRaw}
                onChange={(event) => setArgsRaw(event.target.value)}
                aria-invalid={Boolean(parsedArgs.error || parseError)}
                aria-describedby={
                  parsedArgs.error || parseError
                    ? "call-panel-args-error"
                    : undefined
                }
                className="h-24 w-full resize-none rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-200 focus:outline-none focus:border-cyan-500"
                placeholder='{\n  "to": "G...",\n  "amount": 100\n}'
              />
            </div>
          )}

          {(parseError || parsedArgs.error) && (
            <p
              id="call-panel-args-error"
              className="flex items-center gap-1.5 text-xs text-rose-300"
            >
              <AlertCircle size={14} className="shrink-0" />
              {parseError || parsedArgs.error}
            </p>
          )}

          <button
            onClick={handleInvoke}
            disabled={!canInvoke || isInvoking}
            className={`flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold tracking-wide transition-all duration-200 ${
              !canInvoke || isInvoking
                ? "cursor-not-allowed bg-gray-800 text-gray-600"
                : "bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-lg hover:brightness-110 active:scale-98"
            }`}
          >
            {isInvoking ? (
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-b-transparent border-white" />
            ) : (
              <Send size={16} className="mr-2" />
            )}
            Invoke Function
          </button>
        </div>
      )}
    </div>
  );
}
