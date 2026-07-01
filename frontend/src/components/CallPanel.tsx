import React, { useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";
import {
  buildAbiArguments,
  buildDefaultInputValue,
  validateAbiArguments,
  type ContractAbiFunction,
} from "@/utils/contractAbi";

interface CallPanelProps {
  onInvoke: (func: string, args: Record<string, unknown>) => void;
  isInvoking: boolean;
  contractId?: string;
  abi?: ContractAbiFunction[];
}

export default function CallPanel({ onInvoke, isInvoking, contractId, abi }: CallPanelProps) {
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
    const selectedAbi = abi?.find((entry) => entry.name === trimmedName) ?? null;

    if (!selectedAbi) {
      setFormValues({});
      return;
    }

    const nextValues = (selectedAbi.inputs ?? []).reduce<Record<string, unknown>>(
      (values, input) => {
        values[input.name] = buildDefaultInputValue(input.type);
        return values;
      },
      {},
    );

    setFormValues(nextValues);
  }, [abi, contractId, funcName]);

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

  const abiValidationError = useMemo(() => validateAbiArguments(abiFunction, formValues), [abiFunction, formValues]);
  const canInvoke = Boolean(contractId && funcName.trim()) && !parseError && (!abiFunction ? !parsedArgs.error : !abiValidationError);

  const handleFieldChange = (name: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleInvoke = () => {
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
  };

  return (
    <div className="flex flex-col space-y-4 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg mt-4">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center mb-2">
        Interact with Contract
      </h3>

      {!contractId ? (
        <p className="text-xs text-gray-500 italic">Deploy a contract to enable interactions.</p>
      ) : (
        <div className="space-y-3">
          <div>
            <label htmlFor="call-panel-function-name" className="block text-xs text-gray-400 mb-1 tracking-wide">Function Name</label>
            {abi?.length ? (
              <select
                id="call-panel-function-name"
                value={funcName}
                onChange={(event) => setFuncName(event.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-md py-2 px-3 text-sm text-gray-200 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
              >
                <option value="">Select a function</option>
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
                className="w-full bg-gray-950 border border-gray-800 rounded-md py-2 px-3 text-sm text-gray-200 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                placeholder="e.g. hello"
              />
            )}
          </div>

          {abiFunction && (
            <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-950/40 p-3">
              {abiFunction.inputs?.length ? (
                abiFunction.inputs.map((input) => {
                  const inputId = `call-panel-${input.name}`;
                  const value = formValues[input.name];
                  const inputType = input.type.toLowerCase();
                  const isBoolean = inputType === "bool";
                  const isNumber = ["u8", "u16", "u32", "u64", "u128", "i8", "i16", "i32", "i64", "i128", "f32", "f64"].includes(inputType);

                  return (
                    <div key={input.name}>
                      <label htmlFor={inputId} className="mb-1 block text-xs tracking-wide text-gray-400">
                        {input.name}
                      </label>
                      {isBoolean ? (
                        <label htmlFor={inputId} className="flex items-center gap-2 rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200">
                          <input
                            id={inputId}
                            type="checkbox"
                            checked={Boolean(value)}
                            onChange={(event) => handleFieldChange(input.name, event.target.checked)}
                            className="h-4 w-4 rounded border-gray-700 bg-gray-900"
                          />
                          <span>{input.name}</span>
                        </label>
                      ) : isNumber ? (
                        <input
                          id={inputId}
                          type="number"
                          value={value === undefined || value === null || value === "" ? "" : String(value)}
                          onChange={(event) => handleFieldChange(input.name, event.target.value)}
                          className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                        />
                      ) : (
                        <input
                          id={inputId}
                          type="text"
                          value={value === undefined || value === null ? "" : String(value)}
                          onChange={(event) => handleFieldChange(input.name, event.target.value)}
                          className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                        />
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-gray-500">This function does not require arguments.</p>
              )}
            </div>
          )}

          {!abiFunction && (
            <div>
              <label htmlFor="call-panel-arguments" className="mb-1 block text-xs tracking-wide text-gray-400">Arguments (JSON)</label>
              <textarea
                id="call-panel-arguments"
                value={argsRaw}
                onChange={(event) => setArgsRaw(event.target.value)}
                aria-invalid={Boolean(parsedArgs.error || parseError)}
                aria-describedby={parsedArgs.error || parseError ? "call-panel-args-error" : undefined}
                className="h-24 w-full resize-none rounded-md border border-gray-800 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-200 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                placeholder="{\n  &quot;name&quot;: &quot;Ayomide&quot;\n}"
              />
            </div>
          )}

          {(parseError || parsedArgs.error) && (
            <p id="call-panel-args-error" className="text-xs text-rose-300">
              {parseError || parsedArgs.error}
            </p>
          )}

          <button
            onClick={handleInvoke}
            disabled={!canInvoke || isInvoking}
            className={`flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
              !canInvoke || isInvoking
                ? "cursor-not-allowed bg-gray-800 text-gray-600"
                : "bg-blue-600 text-white shadow-lg hover:bg-blue-500"
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
