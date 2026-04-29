import React from "react";
import { Database } from "lucide-react";
import type { LedgerState } from "@/utils/transactionGraph";
import StorageTimeline from "@/components/StorageTimeline";

interface StorageViewerProps {
  storage: LedgerState;
  previousStorage?: LedgerState;
  contextLabel?: string;
  totalFrames: number;
  currentFrame: number;
  capturedAt?: string;
  onScrubTimeline: (index: number) => void;
}

type DiffKind = "added" | "removed" | "changed";

interface DiffEntry {
  kind: DiffKind;
  path: string;
  previous?: unknown;
  current?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (typeof left !== typeof right) {
    return false;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqual(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    for (const key of leftKeys) {
      if (!(key in right) || !deepEqual(left[key], right[key])) {
        return false;
      }
    }

    return true;
  }

  return false;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "undefined";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable]";
  }
}

function toPath(path: string[]): string {
  if (path.length === 0) {
    return "(root)";
  }

  return path
    .map((part, index) => {
      if (/^\d+$/.test(part)) {
        return `[${part}]`;
      }

      return index === 0 ? part : `.${part}`;
    })
    .join("");
}

function collectBoundaryEntries(kind: "added" | "removed", value: unknown, path: string[], entries: DiffEntry[]): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      entries.push({
        kind,
        path: toPath(path),
        previous: kind === "removed" ? value : undefined,
        current: kind === "added" ? value : undefined,
      });
      return;
    }

    value.forEach((item, index) => collectBoundaryEntries(kind, item, [...path, String(index)], entries));
    return;
  }

  if (isRecord(value)) {
    const nestedEntries = Object.entries(value);
    if (nestedEntries.length === 0) {
      entries.push({
        kind,
        path: toPath(path),
        previous: kind === "removed" ? value : undefined,
        current: kind === "added" ? value : undefined,
      });
      return;
    }

    for (const [key, nested] of nestedEntries) {
      collectBoundaryEntries(kind, nested, [...path, key], entries);
    }
    return;
  }

  entries.push({
    kind,
    path: toPath(path),
    previous: kind === "removed" ? value : undefined,
    current: kind === "added" ? value : undefined,
  });
}

function collectDiffEntries(previous: unknown, current: unknown, path: string[], entries: DiffEntry[]): void {
  if (deepEqual(previous, current)) {
    return;
  }

  if (previous === undefined) {
    collectBoundaryEntries("added", current, path, entries);
    return;
  }

  if (current === undefined) {
    collectBoundaryEntries("removed", previous, path, entries);
    return;
  }

  const previousIsObject = isRecord(previous) || Array.isArray(previous);
  const currentIsObject = isRecord(current) || Array.isArray(current);

  if (previousIsObject && currentIsObject) {
    if (Array.isArray(previous) && Array.isArray(current)) {
      const maxLength = Math.max(previous.length, current.length);
      for (let index = 0; index < maxLength; index += 1) {
        collectDiffEntries(previous[index], current[index], [...path, String(index)], entries);
      }
      return;
    }

    if (isRecord(previous) && isRecord(current)) {
      const keySet = new Set([...Object.keys(previous), ...Object.keys(current)]);
      for (const key of keySet) {
        collectDiffEntries(previous[key], current[key], [...path, key], entries);
      }
      return;
    }
  }

  entries.push({
    kind: "changed",
    path: toPath(path),
    previous,
    current,
  });
}

function createDeepDiff(previous: LedgerState, current: LedgerState): DiffEntry[] {
  const entries: DiffEntry[] = [];
  collectDiffEntries(previous, current, [], entries);
  return entries;
}

function isLongHex(value: string): boolean {
  return /^0x[0-9a-f]+$/i.test(value) && value.length > 72;
}

function renderValue(value: unknown): string {
  const serialized = safeStringify(value);
  if (typeof value === "string" && isLongHex(value)) {
    const byteLength = Math.max(0, (value.length - 2) / 2);
    return `${value.slice(0, 30)}…${value.slice(-30)} [${byteLength} bytes hex]`;
  }

  if (serialized.length > 550) {
    return `${serialized.slice(0, 550)}…`;
  }

  return serialized;
}

function getTopLevelDiffKind(
  key: string,
  previousStorage: LedgerState,
  currentStorage: LedgerState,
): DiffKind | "unchanged" {
  const existsBefore = Object.prototype.hasOwnProperty.call(previousStorage, key);
  const existsNow = Object.prototype.hasOwnProperty.call(currentStorage, key);

  if (!existsBefore && existsNow) {
    return "added";
  }

  if (existsBefore && !existsNow) {
    return "removed";
  }

  if (!deepEqual(previousStorage[key], currentStorage[key])) {
    return "changed";
  }

  return "unchanged";
}

function rowClassesByKind(kind: DiffKind | "unchanged"): string {
  if (kind === "added") {
    return "text-emerald-300";
  }

  if (kind === "removed") {
    return "text-rose-300";
  }

  if (kind === "changed") {
    return "text-amber-300";
  }

  return "text-cyan-300";
}

export default function StorageViewer({
  storage,
  previousStorage = {},
  contextLabel,
  totalFrames,
  currentFrame,
  capturedAt,
  onScrubTimeline,
}: StorageViewerProps) {
  const entries = Object.entries(storage).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  const deepDiffEntries = createDeepDiff(previousStorage, storage);
  const addedCount = deepDiffEntries.filter((entry) => entry.kind === "added").length;
  const removedCount = deepDiffEntries.filter((entry) => entry.kind === "removed").length;
  const changedCount = deepDiffEntries.filter((entry) => entry.kind === "changed").length;

  return (
    <div className="flex flex-col space-y-4 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg mt-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center mb-1">
          <Database size={16} className="mr-2 text-cyan-400" />
          Contract Storage
        </h3>
        {contextLabel ? <p className="text-xs text-gray-500 mb-3">{contextLabel}</p> : null}
        <StorageTimeline
          totalFrames={totalFrames}
          currentFrame={currentFrame}
          contextLabel={contextLabel}
          capturedAt={capturedAt}
          onScrub={onScrubTimeline}
        />
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
                <th className="pb-2 font-medium">Diff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {entries.map(([key, value]) => {
                const topLevelKind = getTopLevelDiffKind(key, previousStorage, storage);
                return (
                <tr key={key}>
                  <td className={`py-2 pr-4 align-top ${rowClassesByKind(topLevelKind)}`}>{key}</td>
                  <td className="py-2 pr-4 text-emerald-300 break-all">
                    <pre className="whitespace-pre-wrap break-all">{renderValue(value)}</pre>
                  </td>
                  <td className={`py-2 align-top uppercase text-[11px] tracking-wide ${rowClassesByKind(topLevelKind)}`}>
                    {topLevelKind}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Frame Diff (Deep)</p>
          <p className="text-[11px] text-gray-500">
            <span className="text-emerald-400">+{addedCount}</span> /{" "}
            <span className="text-rose-400">-{removedCount}</span> /{" "}
            <span className="text-amber-300">~{changedCount}</span>
          </p>
        </div>

        {deepDiffEntries.length === 0 ? (
          <p className="text-xs text-gray-500 italic">No changes from previous frame.</p>
        ) : (
          <div className="max-h-56 overflow-y-auto rounded border border-gray-800">
            <table className="w-full text-left text-xs font-mono">
              <thead className="sticky top-0 bg-gray-950">
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="py-2 px-2 font-medium">Path</th>
                  <th className="py-2 px-2 font-medium">Before</th>
                  <th className="py-2 px-2 font-medium">After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {deepDiffEntries.map((entry) => (
                  <tr
                    key={`${entry.kind}-${entry.path}`}
                    className={
                      entry.kind === "added"
                        ? "bg-emerald-950/20"
                        : entry.kind === "removed"
                          ? "bg-rose-950/20"
                          : "bg-amber-950/10"
                    }
                  >
                    <td
                      className={`py-2 px-2 align-top ${
                        entry.kind === "added"
                          ? "text-emerald-300"
                          : entry.kind === "removed"
                            ? "text-rose-300"
                            : "text-amber-300"
                      }`}
                    >
                      {entry.path}
                    </td>
                    <td className="py-2 px-2 align-top text-gray-400 break-all">
                      {entry.kind === "added" ? "∅" : renderValue(entry.previous)}
                    </td>
                    <td className="py-2 px-2 align-top text-gray-200 break-all">
                      {entry.kind === "removed" ? "∅" : renderValue(entry.current)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
