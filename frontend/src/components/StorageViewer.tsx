import React from "react";
import { Database } from "lucide-react";

interface StorageViewerProps {
  storage: Record<string, string>;
  contextLabel?: string;
}

export default function StorageViewer({ storage, contextLabel }: StorageViewerProps) {
  const entries = Object.entries(storage);

  return (
    <div className="flex flex-col space-y-4 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg mt-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center mb-1">
          <Database size={16} className="mr-2 text-cyan-400" />
          Contract Storage
        </h3>
        {contextLabel ? <p className="text-xs text-gray-500">{contextLabel}</p> : null}
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-gray-500 italic">Storage is empty or inaccessible.</p>
      ) : (
        <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 font-mono text-sm overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-gray-500 text-xs border-b border-gray-800">
                <th className="pb-2 font-medium">Key</th>
                <th className="pb-2 font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {entries.map(([key, val]) => (
                <tr key={key}>
                  <td className="py-2 text-cyan-400 pr-4">{key}</td>
                  <td className="py-2 text-emerald-400 break-all">{val}</td>
                  <td className="py-2 pr-4 align-top text-cyan-300">{key}</td>
                  <td className="py-2 break-all text-emerald-300">{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
