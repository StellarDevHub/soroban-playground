"use client";

import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  FileCode2,
  FileJson,
  FileText,
  Globe2,
  HardDrive,
  Loader2,
  Package,
  Pin,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import {
  checkAvailability as defaultCheckAvailability,
  pinArtifact as defaultPinArtifact,
  STORAGE_PROVIDERS,
  type GatewayStatus,
  type PinArtifactInput,
  type PinArtifactResult,
  type StorageNetwork,
  type StorageProvider,
} from "@/services/pinningService";
import {
  computeArtifactHashes,
  type ArtifactHashes,
} from "@/utils/ipfsCid";

export type ArtifactKind = "source" | "abi" | "build-metadata";

export interface PinnedArtifact {
  id: string;
  name: string;
  kind: ArtifactKind;
  provider: StorageProvider;
  size: number;
  sha256: string;
  cid: string;
  remoteId: string;
  remoteCid?: string;
  uri: string;
  networks: StorageNetwork[];
  gatewayUrls: string[];
  pinnedAt: string;
  persistence: "pinned" | "local";
  cidVerified: boolean | null;
  availability: GatewayStatus[];
}

export interface StoragePinningDashboardProps {
  initialArtifacts?: PinnedArtifact[];
  pinArtifact?: (input: PinArtifactInput) => Promise<PinArtifactResult>;
  checkAvailability?: (
    identifier: string,
    network: StorageNetwork,
  ) => Promise<GatewayStatus[]>;
}

interface SelectedFile {
  file: File;
  data: Uint8Array;
  hashes: ArtifactHashes;
}

const ARTIFACT_KINDS: { value: ArtifactKind; label: string }[] = [
  { value: "source", label: "Contract source" },
  { value: "abi", label: "ABI spec" },
  { value: "build-metadata", label: "Build metadata" },
];

const PROVIDER_LABELS: Record<StorageProvider, string> = {
  pinata: "Pinata",
  web3storage: "Web3.Storage",
  arweave: "Arweave",
  filecoin: "Filecoin",
};

const KIND_LABELS: Record<ArtifactKind, string> = {
  source: "Contract source",
  abi: "ABI spec",
  "build-metadata": "Build metadata",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function guessMimeType(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "json":
      return "application/json";
    case "wasm":
      return "application/wasm";
    case "rs":
    case "toml":
    case "md":
    case "txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function kindForName(name: string): ArtifactKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return "abi";
  if (lower.endsWith(".wasm") || lower.endsWith(".toml")) {
    return "build-metadata";
  }
  return "source";
}

function artifactIdentifier(artifact: PinnedArtifact): string {
  return artifact.networks.includes("arweave")
    ? artifact.remoteId
    : artifact.remoteCid ?? artifact.remoteId;
}

function availabilityNetwork(artifact: PinnedArtifact): StorageNetwork {
  return artifact.networks.includes("arweave") ? "arweave" : "ipfs";
}

function kindIcon(kind: ArtifactKind) {
  if (kind === "abi") return FileJson;
  if (kind === "build-metadata") return Package;
  return FileCode2;
}

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand?.("copy");
  document.body.removeChild(textarea);
}

export default function StoragePinningDashboard({
  initialArtifacts = [],
  pinArtifact = defaultPinArtifact,
  checkAvailability = defaultCheckAvailability,
}: StoragePinningDashboardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [artifactName, setArtifactName] = useState("");
  const [kind, setKind] = useState<ArtifactKind>("source");
  const [provider, setProvider] = useState<StorageProvider>("pinata");
  const [token, setToken] = useState("");
  const [isPinning, setIsPinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<PinnedArtifact[]>(initialArtifacts);
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<
    StorageProvider | "all"
  >("all");
  const [persistenceFilter, setPersistenceFilter] = useState<
    "all" | "pinned" | "local"
  >("all");
  const [copied, setCopied] = useState<string | null>(null);
  const [checking, setChecking] = useState<Record<string, boolean>>({});

  const providerInfo = STORAGE_PROVIDERS.find((item) => item.id === provider);
  const selectedProviderInfo = providerInfo ?? STORAGE_PROVIDERS[0];

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer);
      const hashes = computeArtifactHashes(data);
      setSelected({ file, data, hashes });
      setArtifactName(file.name);
      setKind(kindForName(file.name));
      setError(null);
      setStatus(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Could not hash ${file.name}: ${cause.message}`
          : `Could not hash ${file.name}.`,
      );
    }
  }, []);

  const handlePin = useCallback(async () => {
    if (!selected) return;

    setIsPinning(true);
    setError(null);
    setStatus(null);

    try {
      const mimeType = selected.file.type || guessMimeType(selected.file.name);
      const result = await pinArtifact({
        provider,
        data: selected.data,
        name: artifactName.trim() || selected.file.name,
        mimeType,
        token,
        cid: selected.hashes.cid,
        cidCandidates: selected.hashes.cidCandidates,
      });

      const network = result.networks.includes("arweave")
        ? "arweave"
        : "ipfs";
      const availability = await checkAvailability(
        result.remoteCid ?? result.remoteId,
        network,
      );

      const record: PinnedArtifact = {
        id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: artifactName.trim() || selected.file.name,
        kind,
        provider,
        size: selected.file.size,
        sha256: selected.hashes.sha256,
        cid: selected.hashes.cid,
        remoteId: result.remoteId,
        remoteCid: result.remoteCid,
        uri: result.uri,
        networks: result.networks,
        gatewayUrls: result.gatewayUrls,
        pinnedAt: new Date().toISOString(),
        persistence: "pinned",
        cidVerified: result.cidMatches,
        availability,
      };

      setArtifacts((current) => [record, ...current]);
      setStatus(`${record.name} pinned through ${PROVIDER_LABELS[provider]}.`);

      if (result.cidMatches === false) {
        setError(
          "The remote CID did not match the locally calculated CID. Treat this pin as unverified.",
        );
      }

      setSelected(null);
      setToken("");
      if (inputRef.current) inputRef.current.value = "";
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not pin the artifact.",
      );
    } finally {
      setIsPinning(false);
    }
  }, [
    artifactName,
    checkAvailability,
    kind,
    pinArtifact,
    provider,
    selected,
    token,
  ]);

  const recheck = useCallback(
    async (artifact: PinnedArtifact) => {
      setChecking((current) => ({ ...current, [artifact.id]: true }));
      setError(null);

      try {
        const availability = await checkAvailability(
          artifactIdentifier(artifact),
          availabilityNetwork(artifact),
        );
        setArtifacts((current) =>
          current.map((item) =>
            item.id === artifact.id ? { ...item, availability } : item,
          ),
        );
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not check gateway availability.",
        );
      } finally {
        setChecking((current) => {
          const next = { ...current };
          delete next[artifact.id];
          return next;
        });
      }
    },
    [checkAvailability],
  );

  const handleCopy = useCallback(async (key: string, value: string) => {
    try {
      await copyToClipboard(value);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1_600);
    } catch {
      setError("Could not copy to the clipboard.");
    }
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return artifacts.filter((artifact) => {
      if (providerFilter !== "all" && artifact.provider !== providerFilter) {
        return false;
      }
      if (
        persistenceFilter !== "all" &&
        artifact.persistence !== persistenceFilter
      ) {
        return false;
      }
      if (!q) return true;

      return [
        artifact.name,
        artifact.kind,
        artifact.sha256,
        artifact.cid,
        artifact.remoteId,
        artifact.remoteCid ?? "",
        PROVIDER_LABELS[artifact.provider],
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [artifacts, persistenceFilter, providerFilter, query]);

  const stats = useMemo(() => {
    const verified = artifacts.filter(
      (artifact) => artifact.cidVerified === true,
    ).length;
    const online = artifacts.reduce(
      (sum, artifact) =>
        sum + artifact.availability.filter((gateway) => gateway.available).length,
      0,
    );
    const totalBytes = artifacts.reduce(
      (sum, artifact) => sum + artifact.size,
      0,
    );
    return { verified, online, totalBytes };
  }, [artifacts]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
            <Database size={14} />
            Decentralized Storage
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Contract artifact pinning dashboard
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Hash contract source, ABI specs and build metadata locally, pin them
            to IPFS, Arweave or Filecoin, then verify availability across public
            gateways.
          </p>
        </div>
      </header>

      <section
        aria-label="Pinning summary"
        className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 lg:grid-cols-4"
      >
        <Stat label="Artifacts" value={artifacts.length.toLocaleString()} />
        <Stat label="CID verified" value={stats.verified.toLocaleString()} />
        <Stat label="Gateways online" value={stats.online.toLocaleString()} />
        <Stat label="Total size" value={formatBytes(stats.totalBytes)} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <section
          aria-labelledby="pin-artifact-heading"
          className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5"
        >
          <h2
            id="pin-artifact-heading"
            className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-slate-300"
          >
            <Upload size={15} className="text-cyan-300" />
            Pin an artifact
          </h2>

          <div className="mt-4">
            <input
              ref={inputRef}
              id="artifact-file"
              type="file"
              className="sr-only"
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
            <label
              htmlFor="artifact-file"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-700 bg-slate-900/40 px-4 py-8 text-center transition-colors hover:border-cyan-500/60 hover:bg-slate-900/70 focus-within:border-cyan-400"
            >
              <Upload size={26} className="text-cyan-300" />
              <span className="text-sm font-medium text-slate-200">
                Choose a contract artifact
              </span>
              <span className="text-xs text-slate-500">
                .rs, .json, .wasm, .toml or any build output
              </span>
            </label>
          </div>

          {selected && (
            <div className="mt-4 space-y-3 rounded-xl border border-cyan-900/50 bg-cyan-950/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-white">
                    <FileText size={14} className="text-cyan-300" />
                    {selected.file.name}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {formatBytes(selected.file.size)} · hashed locally before
                    upload
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-700/60 bg-emerald-950/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                  <ShieldCheck size={11} />
                  Local hash
                </span>
              </div>

              <dl className="grid gap-2 text-[11px]">
                <div>
                  <dt className="font-semibold uppercase tracking-widest text-slate-500">
                    SHA-256
                  </dt>
                  <dd className="mt-1 break-all font-mono text-slate-300">
                    {selected.hashes.sha256}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold uppercase tracking-widest text-slate-500">
                    IPFS CIDv1
                  </dt>
                  <dd className="mt-1 break-all font-mono text-cyan-200">
                    {selected.hashes.cid}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-xs text-slate-400">
              <span className="block font-semibold uppercase tracking-widest">
                Artifact name
              </span>
              <input
                value={artifactName}
                onChange={(event) => setArtifactName(event.target.value)}
                placeholder="contract_v1.rs"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
              />
            </label>

            <label className="text-xs text-slate-400">
              <span className="block font-semibold uppercase tracking-widest">
                Artifact type
              </span>
              <select
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as ArtifactKind)
                }
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
              >
                {ARTIFACT_KINDS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset className="mt-4">
            <legend className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Storage provider
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {STORAGE_PROVIDERS.map((option) => {
                const active = provider === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setProvider(option.id)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      active
                        ? "border-cyan-500/70 bg-cyan-950/30"
                        : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2 text-sm font-medium text-white">
                      {option.label}
                      {active && <Check size={14} className="text-cyan-300" />}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="mt-4 block text-xs text-slate-400">
            <span className="block font-semibold uppercase tracking-widest">
              {selectedProviderInfo.tokenLabel}
            </span>
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={selectedProviderInfo.tokenPlaceholder}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
            />
          </label>

          {provider === "arweave" && (
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              Arweave uploads use <code>NEXT_PUBLIC_ARWEAVE_BUNDLER_URL</code>{" "}
              as the bundler endpoint. Configure a bundler that accepts the
              selected authentication token.
            </p>
          )}

          <button
            type="button"
            onClick={() => void handlePin()}
            disabled={!selected || isPinning}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
          >
            {isPinning ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Pin size={16} />
            )}
            {isPinning ? "Pinning artifact…" : "Pin artifact"}
          </button>

          {status && (
            <p
              role="status"
              className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200"
            >
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              {status}
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </section>

        <section
          aria-labelledby="integrity-heading"
          className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5"
        >
          <h2
            id="integrity-heading"
            className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-slate-300"
          >
            <ShieldCheck size={15} className="text-emerald-300" />
            Integrity model
          </h2>
          <div className="mt-4 space-y-3 text-xs leading-5 text-slate-400">
            <p>
              Every file is read in the browser. SHA-256 and UnixFS CIDv1 are
              computed locally before any network request, so the uploaded bytes
              can be compared with the provider response.
            </p>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
              <p className="font-semibold text-slate-200">CID parity</p>
              <p className="mt-1">
                Provider CIDs are matched against the local UnixFS, raw-leaf and
                raw-block candidates. A mismatch is surfaced instead of silently
                accepted.
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
              <p className="font-semibold text-slate-200">Gateway checks</p>
              <p className="mt-1">
                Availability probes use HTTP HEAD requests against ipfs.io,
                dweb.link, w3s.link and Cloudflare for IPFS, or arweave.net and
                Irys for Arweave.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Chunk size
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-200">
                  256 KiB
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Multihash
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-200">
                  sha2-256
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section
        aria-labelledby="pinned-artifacts-heading"
        className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h2
            id="pinned-artifacts-heading"
            className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-slate-300"
          >
            <HardDrive size={15} className="text-indigo-300" />
            Pinned artifacts
            <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-400">
              {filtered.length}/{artifacts.length}
            </span>
          </h2>

          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative text-xs text-slate-400">
              <span className="sr-only">Search pinned artifacts</span>
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-2.5 text-slate-500"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, CID, SHA-256…"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-8 pr-3 text-sm text-white outline-none focus:border-cyan-500 sm:w-64"
              />
            </label>
            <label className="text-xs text-slate-400">
              <span className="sr-only">Filter by provider</span>
              <select
                value={providerFilter}
                onChange={(event) =>
                  setProviderFilter(
                    event.target.value as StorageProvider | "all",
                  )
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500 sm:w-40"
              >
                <option value="all">All providers</option>
                {STORAGE_PROVIDERS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              <span className="sr-only">Filter by pin status</span>
              <select
                value={persistenceFilter}
                onChange={(event) =>
                  setPersistenceFilter(
                    event.target.value as "all" | "pinned" | "local",
                  )
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500 sm:w-36"
              >
                <option value="all">All statuses</option>
                <option value="pinned">Pinned</option>
                <option value="local">Local only</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-full text-left text-xs">
            <caption className="sr-only">
              Pinned contract artifacts with local hashes, provider metadata and
              gateway availability.
            </caption>
            <thead className="bg-slate-900/80 uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Artifact
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Size
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  CID / tx
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Provider
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Pin status
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Gateways
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900 bg-slate-950/40">
              {filtered.map((artifact) => {
                const KindIcon = kindIcon(artifact.kind);
                const online = artifact.availability.filter(
                  (gateway) => gateway.available,
                ).length;
                const isChecking = Boolean(checking[artifact.id]);
                const copyKey = `${artifact.id}-uri`;

                return (
                  <tr key={artifact.id} className="align-top">
                    <td className="px-3 py-3">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-300">
                          <KindIcon size={13} />
                        </span>
                        <div className="min-w-0">
                          <p className="max-w-[16rem] truncate font-medium text-slate-100">
                            {artifact.name}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {KIND_LABELS[artifact.kind]}
                          </p>
                          <p className="mt-1 max-w-[18rem] truncate font-mono text-[10px] text-slate-600">
                            sha256:{artifact.sha256}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-300">
                      {formatBytes(artifact.size)}
                    </td>
                    <td className="px-3 py-3">
                      <p className="max-w-[14rem] truncate font-mono text-[11px] text-cyan-200">
                        {artifactIdentifier(artifact)}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-500">
                        {artifact.networks.includes("arweave")
                          ? "Arweave tx"
                          : "IPFS CIDv1"}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                        {PROVIDER_LABELS[artifact.provider]}
                      </span>
                      <p className="mt-1 text-[10px] text-slate-500">
                        {artifact.networks
                          .map((network) => network.toUpperCase())
                          .join(" · ")}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      {artifact.cidVerified === false ? (
                        <span className="inline-flex items-center gap-1 text-rose-300">
                          <XCircle size={12} />
                          CID mismatch
                        </span>
                      ) : artifact.cidVerified === true ? (
                        <span className="inline-flex items-center gap-1 text-emerald-300">
                          <CheckCircle2 size={12} />
                          Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-400">
                          <Globe2 size={12} />
                          {artifact.persistence === "pinned"
                            ? "Pinned"
                            : "Local only"}
                        </span>
                      )}
                      <p className="mt-1 text-[10px] text-slate-500">
                        {new Date(artifact.pinnedAt).toLocaleString()}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      {isChecking ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                          <Loader2 size={12} className="animate-spin" />
                          Checking…
                        </span>
                      ) : artifact.availability.length === 0 ? (
                        <span className="text-[11px] text-slate-500">
                          Not checked
                        </span>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            {artifact.availability.map((gateway) => (
                              <span
                                key={gateway.gateway}
                                title={`${gateway.gateway}: ${
                                  gateway.available ? "available" : "unavailable"
                                }`}
                                aria-label={`${gateway.gateway} ${
                                  gateway.available ? "available" : "unavailable"
                                }`}
                                className={`inline-block h-2.5 w-2.5 rounded-full ${
                                  gateway.available
                                    ? "bg-emerald-400"
                                    : "bg-rose-500"
                                }`}
                              />
                            ))}
                            <span className="text-[10px] text-slate-500">
                              {online}/{artifact.availability.length}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {artifact.gatewayUrls.slice(0, 2).map((url) => (
                              <a
                                key={url}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-0.5 text-[10px] text-cyan-400 hover:text-cyan-300"
                              >
                                <ExternalLink size={9} />
                                {new URL(url).hostname}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleCopy(copyKey, artifact.uri)}
                          aria-label={`Copy ${artifact.uri}`}
                          title={artifact.uri}
                          className="rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-300 transition-colors hover:border-cyan-600 hover:text-cyan-200"
                        >
                          {copied === copyKey ? (
                            <Check size={13} />
                          ) : (
                            <Copy size={13} />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void recheck(artifact)}
                          disabled={isChecking}
                          aria-label={`Recheck gateways for ${artifact.name}`}
                          className="rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-300 transition-colors hover:border-cyan-600 hover:text-cyan-200 disabled:opacity-50"
                        >
                          <RefreshCw
                            size={13}
                            className={isChecking ? "animate-spin" : undefined}
                          />
                        </button>
                      </div>
                      <p className="mt-1 max-w-[9rem] truncate font-mono text-[10px] text-slate-600">
                        {artifact.uri}
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Database size={22} className="text-slate-600" />
              <p className="text-sm font-medium text-slate-300">
                {artifacts.length === 0
                  ? "No artifacts pinned yet"
                  : "No artifacts match these filters"}
              </p>
              <p className="max-w-sm text-xs text-slate-500">
                {artifacts.length === 0
                  ? "Choose a source file, ABI or build artifact above to compute its CID and pin it."
                  : "Clear the search or choose a different provider/status filter."}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
      {label}
    </p>
    <p className="mt-1 text-lg font-bold text-white">{value}</p>
  </div>
);
