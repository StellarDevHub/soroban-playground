import React from "react";
import { Terminal } from "lucide-react";

interface ConsoleProps {
  logs: string[];
}

export default function Console({ logs }: ConsoleProps) {
  return (
    <div className="flex flex-col h-64 bg-gray-950 border border-gray-800 rounded-xl overflow-hidden shadow-inner">
      <div className="flex items-center space-x-2 px-4 py-2 bg-gray-900 border-b border-gray-800 rounded-t-xl text-xs text-gray-400 font-medium tracking-wider uppercase">
        <Terminal size={14} />
        <span>Console Output</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-2">
        {logs.length === 0 ? (
          <p className="text-gray-600 italic">No output yet. Compile or deploy to see logs.</p>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="text-gray-300 break-words whitespace-pre-wrap">
              <span className="text-cyan-500 mr-2">{String(i + 1).padStart(2, "0")}</span>
              {log}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
