"use client";

interface EditorTabsProps {
  files: string[];
  activeFile: string;
  onSelect: (path: string) => void;
  onCreate: () => void;
}

export default function EditorTabs({
  files,
  activeFile,
  onSelect,
  onCreate,
}: EditorTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Open source files"
      className="mb-2 flex items-center gap-1 overflow-x-auto border-b border-gray-800"
    >
      {files.map((path) => (
        <button
          key={path}
          type="button"
          role="tab"
          aria-selected={path === activeFile}
          onClick={() => onSelect(path)}
          className={`shrink-0 border-b-2 px-3 py-2 text-xs font-mono transition ${
            path === activeFile
              ? "border-teal-400 text-teal-200"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          {path.split("/").pop()}
        </button>
      ))}
      <button
        type="button"
        aria-label="Create source file"
        onClick={onCreate}
        className="ml-auto shrink-0 rounded px-2 py-1 text-slate-400 hover:bg-white/5 hover:text-white"
      >
        +
      </button>
    </div>
  );
}
