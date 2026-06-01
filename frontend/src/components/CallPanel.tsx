import React, { useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";

interface CallPanelProps {
  onInvoke: (func: string, args: Record<string, string>) => void;
  isInvoking: boolean;
  contractId?: string;
}

export default function CallPanel({ onInvoke, isInvoking, contractId }: CallPanelProps) {
  const [funcName, setFuncName] = useState("");
  const [argsRaw, setArgsRaw] = useState("");
  const [parseError, setParseError] = useState("");

  useEffect(() => {
    setParseError("");
  }, [argsRaw, funcName, contractId]);

  useEffect(() => {
    if (!contractId) {
      setFuncName("");
      setArgsRaw("");
      setParseError("");
    }
  }, [contractId]);

  const parsedArgs = useMemo(() => {
    const trimmed = argsRaw.trim();
    if (!trimmed) {
      return { value: {} as Record<string, string>, error: "" };
    }

    try {
      const value = JSON.parse(trimmed) as Record<string, string>;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return {
          value: {} as Record<string, string>,
          error: "Arguments must be a JSON object.",
        };
      }

      return { value, error: "" };
    } catch {
      return {
        value: {} as Record<string, string>,
        error: "Arguments must be valid JSON.",
      };
    }
  }, [argsRaw]);

  const canInvoke = Boolean(contractId && funcName.trim()) && !parsedArgs.error;

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
            <input 
              id="call-panel-function-name"
              type="text" 
              value={funcName}
              onChange={(e) => setFuncName(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-md py-2 px-3 text-sm text-gray-200 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
              placeholder="e.g. hello"
            />
          </div>
          
          <div>
            <label htmlFor="call-panel-arguments" className="block text-xs text-gray-400 mb-1 tracking-wide">Arguments (JSON)</label>
            <textarea 
              id="call-panel-arguments"
              value={argsRaw}
              onChange={(e) => setArgsRaw(e.target.value)}
              aria-invalid={Boolean(parsedArgs.error || parseError)}
              aria-describedby={
                parsedArgs.error || parseError ? "call-panel-args-error" : undefined
              }
              className="w-full h-24 bg-gray-950 border border-gray-800 rounded-md py-2 px-3 text-sm text-gray-200 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 font-mono resize-none"
              placeholder="{\n  &quot;name&quot;: &quot;Ayomide&quot;\n}"
            />
          </div>

          {(parseError || parsedArgs.error) && (
            <p id="call-panel-args-error" className="text-xs text-rose-300">
              {parseError || parsedArgs.error}
            </p>
          )}

          <button
            onClick={handleInvoke}
            disabled={!canInvoke || isInvoking}
            className={`w-full flex items-center justify-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              !canInvoke || isInvoking
                ? "bg-gray-800 text-gray-600 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg"
            }`}
          >
            {isInvoking ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-b-transparent border-white mr-2" />
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
