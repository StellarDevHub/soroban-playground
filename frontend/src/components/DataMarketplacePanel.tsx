"use client";

import React, { useMemo, useState } from "react";
import {
  Database,
  ShieldCheck,
  Lock,
  Activity,
  Coins,
  PlusCircle,
  Search,
  Zap,
  KeyRound,
  Users,
  XCircle,
} from "lucide-react";

export type ProviderProfile = {
  address: string;
  name: string;
  contactHash: string;
};

export type Dataset = {
  id: number;
  provider: string;
  title: string;
  schemaHash: string;
  manifestHash: string;
  encryptionPubkey: string;
  flatPrice: number;
  pricePerQuery: number;
  licenseSeconds: number;
  listedAt: number;
  delisted: boolean;
};

export type License = {
  datasetId: number;
  buyer: string;
  purchasedAt: number;
  expiresAt: number;
  queriesTotal: number;
  queriesUsed: number;
  totalPaid: number;
};

export type DatasetStats = {
  licenseCount: number;
  activeBuyers: number;
  queriesExecuted: number;
  revenue: number;
};

export type QueryReceipt = {
  commitment: string;
  datasetId: number;
  buyer: string;
  timestamp: number;
  sequence: number;
};

interface DataMarketplacePanelProps {
  acting: string;
  provider?: ProviderProfile;
  datasets: Dataset[];
  myDatasets: Dataset[];
  myLicenses: License[];
  selectedDataset?: Dataset;
  selectedStats?: DatasetStats;
  recentReceipts: QueryReceipt[];
  onRegisterProvider: (input: { name: string; contactHash: string }) => Promise<void>;
  onListDataset: (input: ListDatasetInput) => Promise<void>;
  onSelectDataset: (id: number) => void;
  onPurchase: (datasetId: number, maxQueries: number) => Promise<void>;
  onSubmitQuery: (datasetId: number, query: string, nonce: string) => Promise<{ commitment: string }>;
  onDelist: (datasetId: number) => Promise<void>;
  isLoading?: boolean;
  error?: string;
}

type ListDatasetInput = {
  title: string;
  schemaHash: string;
  manifestHash: string;
  encryptionPubkey: string;
  flatPrice: number;
  pricePerQuery: number;
  licenseSeconds: number;
};

const fmtTime = (ts: number) => {
  const seconds = Math.floor(Date.now() / 1000) - ts;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
};

const fmtNumber = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : `${n}`;

const shortHash = (h: string) => (h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h);

const DataMarketplacePanel: React.FC<DataMarketplacePanelProps> = ({
  acting,
  provider,
  datasets,
  myDatasets,
  myLicenses,
  selectedDataset,
  selectedStats,
  recentReceipts,
  onRegisterProvider,
  onListDataset,
  onSelectDataset,
  onPurchase,
  onSubmitQuery,
  onDelist,
  isLoading,
  error,
}) => {
  const [tab, setTab] = useState<"marketplace" | "studio" | "analytics">("marketplace");
  const [search, setSearch] = useState("");
  const [showRegister, setShowRegister] = useState(false);
  const [showList, setShowList] = useState(false);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    if (!search.trim()) return datasets;
    const q = search.trim().toLowerCase();
    return datasets.filter((d) => d.title.toLowerCase().includes(q) || d.provider.toLowerCase().includes(q));
  }, [datasets, search]);

  const license = useMemo(() => {
    if (!selectedDataset) return undefined;
    return myLicenses.find((l) => l.datasetId === selectedDataset.id);
  }, [selectedDataset, myLicenses]);

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <header className="rounded-3xl border border-cyan-500/20 bg-gradient-to-r from-cyan-900/30 to-indigo-900/30 p-6 backdrop-blur-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-300">Acting as</p>
            <p className="mt-1 font-mono text-xs text-white">{acting}</p>
            {provider && (
              <p className="mt-2 text-sm text-slate-300">
                Provider: <span className="font-semibold text-white">{provider.name}</span>
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {!provider && (
              <button
                onClick={() => setShowRegister(true)}
                className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20"
              >
                Register as provider
              </button>
            )}
            {provider && (
              <button
                onClick={() => setShowList(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
              >
                <PlusCircle size={14} /> List dataset
              </button>
            )}
          </div>
        </div>
      </header>

      <nav role="tablist" aria-label="Marketplace sections" className="flex gap-2">
        {(["marketplace", "studio", "analytics"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wider transition ${
              tab === t ? "bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/40" : "bg-white/5 text-slate-400 hover:bg-white/10"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "marketplace" && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <section aria-label="Available datasets" className="xl:col-span-2 space-y-4">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-3">
              <Search size={14} className="text-slate-500" aria-hidden />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search datasets…"
                className="w-full bg-transparent py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none"
                aria-label="Search datasets"
              />
            </div>
            {filtered.length === 0 ? (
              <EmptyState message="No datasets match your search." />
            ) : (
              filtered.map((d) => (
                <DatasetCard
                  key={d.id}
                  dataset={d}
                  isOwn={d.provider === acting}
                  selected={selectedDataset?.id === d.id}
                  onSelect={() => onSelectDataset(d.id)}
                />
              ))
            )}
          </section>

          <aside className="space-y-4">
            <DetailPanel
              acting={acting}
              dataset={selectedDataset}
              license={license}
              onPurchase={onPurchase}
              onSubmitQuery={onSubmitQuery}
              onDelist={onDelist}
              busy={busy || Boolean(isLoading)}
              setBusy={setBusy}
            />
          </aside>
        </div>
      )}

      {tab === "studio" && (
        <section aria-label="Provider studio" className="space-y-4">
          {!provider ? (
            <EmptyState message="Register as a provider to list datasets." />
          ) : myDatasets.length === 0 ? (
            <EmptyState message="No datasets listed yet." />
          ) : (
            myDatasets.map((d) => (
              <DatasetCard
                key={d.id}
                dataset={d}
                isOwn
                selected={selectedDataset?.id === d.id}
                onSelect={() => onSelectDataset(d.id)}
              />
            ))
          )}
        </section>
      )}

      {tab === "analytics" && (
        <section aria-label="Analytics" className="space-y-6">
          {!selectedDataset || !selectedStats ? (
            <EmptyState message="Select a dataset to see usage analytics." />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <MetricCard label="Licenses" value={fmtNumber(selectedStats.licenseCount)} icon={<KeyRound size={14} />} accent="text-violet-300" />
                <MetricCard label="Active buyers" value={fmtNumber(selectedStats.activeBuyers)} icon={<Users size={14} />} accent="text-emerald-300" />
                <MetricCard label="Queries" value={fmtNumber(selectedStats.queriesExecuted)} icon={<Activity size={14} />} accent="text-amber-300" />
                <MetricCard label="Revenue" value={fmtNumber(selectedStats.revenue)} icon={<Coins size={14} />} accent="text-cyan-300" />
              </div>

              <div className="rounded-3xl border border-white/5 bg-slate-900/40 p-6">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
                  <ShieldCheck size={14} /> Recent privacy-preserving query receipts
                </h3>
                {recentReceipts.length === 0 ? (
                  <EmptyState message="No queries recorded for this dataset yet." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <caption className="sr-only">Recent commitment receipts</caption>
                      <thead className="text-[10px] uppercase tracking-widest text-slate-400">
                        <tr>
                          <th scope="col" className="px-3 py-2">#</th>
                          <th scope="col" className="px-3 py-2">Commitment</th>
                          <th scope="col" className="px-3 py-2">Buyer</th>
                          <th scope="col" className="px-3 py-2">When</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-300">
                        {recentReceipts.map((r) => (
                          <tr key={r.commitment} className="border-t border-white/5">
                            <td className="px-3 py-2 font-mono text-[11px]">{r.sequence}</td>
                            <td className="px-3 py-2 font-mono text-[11px]" title={r.commitment}>
                              {shortHash(r.commitment)}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px]">{shortHash(r.buyer)}</td>
                            <td className="px-3 py-2">{fmtTime(r.timestamp)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {showRegister && !provider && (
        <RegisterDialog
          onClose={() => setShowRegister(false)}
          onSubmit={async (input) => {
            await onRegisterProvider(input);
            setShowRegister(false);
          }}
        />
      )}

      {showList && provider && (
        <ListDialog
          onClose={() => setShowList(false)}
          onSubmit={async (input) => {
            await onListDataset(input);
            setShowList(false);
          }}
        />
      )}
    </div>
  );
};

// ── Subcomponents ───────────────────────────────────────────────────────────

const DatasetCard: React.FC<{
  dataset: Dataset;
  isOwn: boolean;
  selected: boolean;
  onSelect: () => void;
}> = ({ dataset, isOwn, selected, onSelect }) => (
  <button
    onClick={onSelect}
    className={`block w-full rounded-3xl border p-5 text-left transition ${
      selected ? "border-cyan-400/50 bg-cyan-500/10" : "border-white/5 bg-slate-900/40 hover:border-white/10"
    }`}
    aria-pressed={selected}
  >
    <div className="flex items-start justify-between gap-3">
      <div>
        <h4 className="text-base font-bold text-white">{dataset.title}</h4>
        <p className="text-xs text-slate-400">
          By <span className="font-mono">{shortHash(dataset.provider)}</span> · {fmtTime(dataset.listedAt)}
        </p>
      </div>
      {dataset.delisted ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
          <XCircle size={10} /> Delisted
        </span>
      ) : isOwn ? (
        <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-200">Yours</span>
      ) : null}
    </div>
    <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-slate-400">
      <div>
        <dt className="uppercase tracking-widest">Flat</dt>
        <dd className="text-white">{fmtNumber(dataset.flatPrice)}</dd>
      </div>
      <div>
        <dt className="uppercase tracking-widest">Per query</dt>
        <dd className="text-white">{fmtNumber(dataset.pricePerQuery)}</dd>
      </div>
      <div>
        <dt className="uppercase tracking-widest">License</dt>
        <dd className="text-white">{Math.round(dataset.licenseSeconds / 86_400)}d</dd>
      </div>
    </dl>
    <p className="mt-2 truncate font-mono text-[10px] text-slate-500">manifest: {dataset.manifestHash}</p>
  </button>
);

const DetailPanel: React.FC<{
  acting: string;
  dataset?: Dataset;
  license?: License;
  onPurchase: (id: number, qty: number) => Promise<void>;
  onSubmitQuery: (id: number, query: string, nonce: string) => Promise<{ commitment: string }>;
  onDelist: (id: number) => Promise<void>;
  busy: boolean;
  setBusy: (b: boolean) => void;
}> = ({ acting, dataset, license, onPurchase, onSubmitQuery, onDelist, busy, setBusy }) => {
  const [qty, setQty] = useState("10");
  const [query, setQuery] = useState("");
  const [nonce, setNonce] = useState(() => Math.random().toString(36).slice(2));
  const [lastCommitment, setLastCommitment] = useState<string | undefined>();

  if (!dataset) {
    return <EmptyState message="Select a dataset to see details." />;
  }
  const isOwner = dataset.provider === acting;

  const purchase = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(qty);
    if (!Number.isInteger(n) || n <= 0) return;
    setBusy(true);
    try {
      await onPurchase(dataset.id, n);
    } finally {
      setBusy(false);
    }
  };

  const runQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      const result = await onSubmitQuery(dataset.id, query.trim(), nonce);
      setLastCommitment(result.commitment);
      setNonce(Math.random().toString(36).slice(2));
      setQuery("");
    } finally {
      setBusy(false);
    }
  };

  const remaining = license ? Math.max(0, license.queriesTotal - license.queriesUsed) : 0;
  const expired = license ? license.expiresAt * 1000 < Date.now() : false;
  const canQuery = Boolean(license) && !expired && remaining > 0 && !isOwner;

  return (
    <div className="space-y-4 rounded-3xl border border-white/5 bg-slate-900/40 p-5">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-bold text-white">
          <Database size={14} /> {dataset.title}
        </h3>
        <p className="mt-1 truncate font-mono text-[11px] text-slate-500">schema: {dataset.schemaHash}</p>
        <p className="truncate font-mono text-[11px] text-slate-500">pubkey: {dataset.encryptionPubkey}</p>
      </div>

      {license && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200">
          <p className="font-semibold">License active</p>
          <p className="text-slate-300">
            {license.queriesUsed}/{license.queriesTotal} queries used · expires {new Date(license.expiresAt * 1000).toLocaleString()}
          </p>
        </div>
      )}

      {!isOwner && (
        <form onSubmit={purchase} className="space-y-2 rounded-2xl border border-white/5 bg-slate-950 p-3">
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400" htmlFor="dm-qty">
            Buy queries
          </label>
          <div className="flex gap-2">
            <input
              id="dm-qty"
              type="number"
              min="1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-24 rounded-xl border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-white"
            />
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-xl bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
            >
              <Coins size={12} /> Purchase
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            Cost: {dataset.flatPrice + dataset.pricePerQuery * Math.max(0, Number(qty) || 0)}
          </p>
        </form>
      )}

      {!isOwner && (
        <form onSubmit={runQuery} className="space-y-2 rounded-2xl border border-white/5 bg-slate-950 p-3">
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400" htmlFor="dm-query">
            Privacy-preserving query
          </label>
          <textarea
            id="dm-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={!canQuery}
            rows={3}
            placeholder={canQuery ? "SELECT … " : "Buy a license to run queries"}
            className="w-full rounded-xl border border-white/10 bg-slate-900 px-2 py-1.5 font-mono text-[11px] text-white disabled:opacity-50"
          />
          <p className="font-mono text-[10px] text-slate-500">nonce: {nonce}</p>
          <button
            type="submit"
            disabled={!canQuery || busy}
            className="inline-flex items-center gap-1 rounded-xl bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-400 disabled:opacity-50"
          >
            <Zap size={12} /> Submit commitment
          </button>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            <Lock size={10} className="inline" /> The query never leaves your device — only its SHA-256 commitment is recorded on-chain.
          </p>
          {lastCommitment && (
            <p className="break-all font-mono text-[10px] text-emerald-300">commitment: {lastCommitment}</p>
          )}
        </form>
      )}

      {isOwner && !dataset.delisted && (
        <button
          type="button"
          onClick={() => onDelist(dataset.id)}
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
        >
          <XCircle size={12} /> Delist dataset
        </button>
      )}
    </div>
  );
};

const RegisterDialog: React.FC<{
  onClose: () => void;
  onSubmit: (input: { name: string; contactHash: string }) => Promise<void>;
}> = ({ onClose, onSubmit }) => {
  const [name, setName] = useState("");
  const [contactHash, setContactHash] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Register as a data provider" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSubmit({ name: name.trim(), contactHash: contactHash.trim() });
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-3"
      >
        <Field label="Display name" htmlFor="dm-name">
          <input
            id="dm-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={64}
            className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
          />
        </Field>
        <Field label="Contact hash (64 hex)" htmlFor="dm-contact">
          <input
            id="dm-contact"
            value={contactHash}
            onChange={(e) => setContactHash(e.target.value)}
            required
            pattern="[A-Fa-f0-9]{64}"
            className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
          />
        </Field>
        <DialogFooter onClose={onClose} busy={busy} submitLabel="Register" />
      </form>
    </Dialog>
  );
};

const ListDialog: React.FC<{
  onClose: () => void;
  onSubmit: (input: ListDatasetInput) => Promise<void>;
}> = ({ onClose, onSubmit }) => {
  const [form, setForm] = useState<ListDatasetInput>({
    title: "",
    schemaHash: "",
    manifestHash: "",
    encryptionPubkey: "",
    flatPrice: 0,
    pricePerQuery: 0,
    licenseSeconds: 30 * 86_400,
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ListDatasetInput>(k: K, v: ListDatasetInput[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));
  return (
    <Dialog title="List a dataset" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSubmit(form);
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-3"
      >
        <Field label="Title" htmlFor="dm-title">
          <input
            id="dm-title"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            required
            maxLength={200}
            className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Schema hash" htmlFor="dm-schema">
            <input
              id="dm-schema"
              value={form.schemaHash}
              onChange={(e) => set("schemaHash", e.target.value)}
              required
              pattern="[A-Fa-f0-9]{64}"
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-[11px] text-white"
            />
          </Field>
          <Field label="Manifest hash" htmlFor="dm-manifest">
            <input
              id="dm-manifest"
              value={form.manifestHash}
              onChange={(e) => set("manifestHash", e.target.value)}
              required
              pattern="[A-Fa-f0-9]{64}"
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-[11px] text-white"
            />
          </Field>
          <Field label="Encryption pubkey" htmlFor="dm-pubkey">
            <input
              id="dm-pubkey"
              value={form.encryptionPubkey}
              onChange={(e) => set("encryptionPubkey", e.target.value)}
              required
              pattern="[A-Fa-f0-9]{64}"
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-[11px] text-white"
            />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Flat price" htmlFor="dm-flat">
            <input
              id="dm-flat"
              type="number"
              min="0"
              value={form.flatPrice}
              onChange={(e) => set("flatPrice", Number(e.target.value) || 0)}
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </Field>
          <Field label="Per query" htmlFor="dm-perquery">
            <input
              id="dm-perquery"
              type="number"
              min="0"
              value={form.pricePerQuery}
              onChange={(e) => set("pricePerQuery", Number(e.target.value) || 0)}
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </Field>
          <Field label="License (s)" htmlFor="dm-secs">
            <input
              id="dm-secs"
              type="number"
              min="1"
              value={form.licenseSeconds}
              onChange={(e) => set("licenseSeconds", Number(e.target.value) || 1)}
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </Field>
        </div>
        <DialogFooter onClose={onClose} busy={busy} submitLabel="List dataset" />
      </form>
    </Dialog>
  );
};

const Dialog: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title,
  onClose,
  children,
}) => (
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="dm-dialog-title"
    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm"
    onClick={onClose}
  >
    <div
      className="w-full max-w-xl space-y-4 rounded-3xl border border-cyan-500/30 bg-slate-900 p-6"
      onClick={(e) => e.stopPropagation()}
    >
      <h3 id="dm-dialog-title" className="text-base font-bold text-white">
        {title}
      </h3>
      {children}
    </div>
  </div>
);

const DialogFooter: React.FC<{ onClose: () => void; busy: boolean; submitLabel: string }> = ({
  onClose,
  busy,
  submitLabel,
}) => (
  <div className="flex justify-end gap-2 pt-2">
    <button
      type="button"
      onClick={onClose}
      className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
    >
      Cancel
    </button>
    <button
      type="submit"
      disabled={busy}
      className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50"
    >
      {busy ? "Working…" : submitLabel}
    </button>
  </div>
);

const Field: React.FC<{ label: string; htmlFor: string; children: React.ReactNode }> = ({
  label,
  htmlFor,
  children,
}) => (
  <div className="space-y-1.5">
    <label htmlFor={htmlFor} className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
      {label}
    </label>
    {children}
  </div>
);

const MetricCard: React.FC<{ label: string; value: string; icon: React.ReactNode; accent: string }> = ({
  label,
  value,
  icon,
  accent,
}) => (
  <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
    <div className={`flex items-center gap-2 ${accent}`}>
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
    </div>
    <p className="mt-2 text-2xl font-bold text-white">{value}</p>
  </div>
);

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-10 text-center text-sm text-slate-400">
    {message}
  </div>
);

export default DataMarketplacePanel;
