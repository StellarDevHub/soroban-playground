"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Database } from "lucide-react";
import DataMarketplacePanel, {
  Dataset,
  License,
  DatasetStats,
  ProviderProfile,
  QueryReceipt,
} from "@/components/DataMarketplacePanel";

type PlatformAnalytics = {
  providers: number;
  datasets: number;
  activeListings: number;
  buyers: number;
  totalRevenue: number;
  totalQueries: number;
};

const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:5000";
const API = `${API_BASE}/api/marketplace`;
const FALLBACK_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    throw new Error(body?.message || `Request failed: ${res.status}`);
  }
  return (body?.data ?? body) as T;
}

/// Compute SHA-256 of `query || nonce || buyer` entirely in the browser. The
/// raw query never leaves the device — only its 32-byte commitment is sent to
/// the marketplace.
async function commitQuery(query: string, nonce: string, buyer: string): Promise<string> {
  const enc = new TextEncoder();
  const payload = enc.encode(`${query}|${nonce}|${buyer}`);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function DataMarketplacePage() {
  const [acting, setActing] = useState<string>(FALLBACK_ADDRESS);
  const [provider, setProvider] = useState<ProviderProfile | undefined>();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [myDatasets, setMyDatasets] = useState<Dataset[]>([]);
  const [myLicenses, setMyLicenses] = useState<License[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<Dataset | undefined>();
  const [selectedStats, setSelectedStats] = useState<DatasetStats | undefined>();
  const [recentReceipts, setRecentReceipts] = useState<QueryReceipt[]>([]);
  const [platform, setPlatform] = useState<PlatformAnalytics | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);

  const refreshDatasets = useCallback(async () => {
    try {
      const data = await jsonOrThrow<Dataset[]>(await fetch(`${API}/datasets?limit=50`));
      setDatasets(data);
    } catch (err) {
      console.warn("dataset feed unavailable", err);
    }
  }, []);

  const refreshProvider = useCallback(async (addr: string) => {
    if (!addr) return;
    try {
      const profile = await jsonOrThrow<ProviderProfile>(await fetch(`${API}/providers/${addr}`));
      setProvider(profile);
      const own = await jsonOrThrow<Dataset[]>(await fetch(`${API}/providers/${addr}/datasets`));
      setMyDatasets(own);
    } catch (err) {
      if (err instanceof Error && /not found/i.test(err.message)) {
        setProvider(undefined);
        setMyDatasets([]);
        return;
      }
      console.warn("provider refresh failed", err);
    }
  }, []);

  const refreshLicenses = useCallback(
    async (addr: string, available: Dataset[]) => {
      if (!addr || available.length === 0) {
        setMyLicenses([]);
        return;
      }
      const settled = await Promise.allSettled(
        available.map((d) =>
          fetch(`${API}/licenses/${d.id}/${addr}`)
            .then((r) => (r.ok ? jsonOrThrow<License>(r) : null))
            .catch(() => null)
        )
      );
      const licenses = settled
        .map((s) => (s.status === "fulfilled" ? s.value : null))
        .filter((l): l is License => l !== null);
      setMyLicenses(licenses);
    },
    []
  );

  const refreshSelected = useCallback(async (id?: number) => {
    if (!id) {
      setSelectedStats(undefined);
      setRecentReceipts([]);
      return;
    }
    try {
      const stats = await jsonOrThrow<DatasetStats>(await fetch(`${API}/datasets/${id}/analytics`));
      setSelectedStats(stats);
    } catch {
      setSelectedStats(undefined);
    }
  }, []);

  const refreshPlatform = useCallback(async () => {
    try {
      const data = await jsonOrThrow<PlatformAnalytics>(await fetch(`${API}/analytics/platform`));
      setPlatform(data);
    } catch (err) {
      console.warn("platform analytics unavailable", err);
    }
  }, []);

  useEffect(() => {
    refreshDatasets();
    refreshPlatform();
  }, [refreshDatasets, refreshPlatform]);

  useEffect(() => {
    refreshProvider(acting);
  }, [acting, refreshProvider]);

  useEffect(() => {
    refreshLicenses(acting, datasets);
  }, [acting, datasets, refreshLicenses]);

  const handleSelectDataset = (id: number) => {
    const ds = datasets.find((d) => d.id === id) ?? myDatasets.find((d) => d.id === id);
    setSelectedDataset(ds);
    refreshSelected(id);
  };

  const wrap = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setError(undefined);
    setIsLoading(true);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
      return undefined;
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegisterProvider: React.ComponentProps<typeof DataMarketplacePanel>["onRegisterProvider"] = async (
    input
  ) => {
    await wrap("Provider registration", async () => {
      await jsonOrThrow(
        await fetch(`${API}/providers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: acting, ...input }),
        })
      );
      await refreshProvider(acting);
    });
  };

  const handleListDataset: React.ComponentProps<typeof DataMarketplacePanel>["onListDataset"] = async (input) => {
    await wrap("Listing dataset", async () => {
      await jsonOrThrow(
        await fetch(`${API}/datasets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: acting, ...input }),
        })
      );
      await Promise.all([refreshDatasets(), refreshProvider(acting), refreshPlatform()]);
    });
  };

  const handlePurchase: React.ComponentProps<typeof DataMarketplacePanel>["onPurchase"] = async (
    datasetId,
    maxQueries
  ) => {
    await wrap("Purchase", async () => {
      await jsonOrThrow(
        await fetch(`${API}/licenses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ buyer: acting, datasetId, maxQueries }),
        })
      );
      await Promise.all([refreshLicenses(acting, datasets), refreshSelected(datasetId), refreshPlatform()]);
    });
  };

  const handleSubmitQuery: React.ComponentProps<typeof DataMarketplacePanel>["onSubmitQuery"] = async (
    datasetId,
    query,
    nonce
  ) => {
    const commitment = await commitQuery(query, nonce, acting);
    const receipt = await wrap("Query", async () => {
      const data = await jsonOrThrow<QueryReceipt>(
        await fetch(`${API}/queries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ buyer: acting, datasetId, commitment }),
        })
      );
      setRecentReceipts((prev) => [data, ...prev].slice(0, 20));
      await Promise.all([refreshLicenses(acting, datasets), refreshSelected(datasetId)]);
      return data;
    });
    return { commitment: receipt?.commitment ?? commitment };
  };

  const handleDelist: React.ComponentProps<typeof DataMarketplacePanel>["onDelist"] = async (datasetId) => {
    await wrap("Delist", async () => {
      await jsonOrThrow(
        await fetch(`${API}/datasets/${datasetId}/delist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: acting }),
        })
      );
      await Promise.all([refreshDatasets(), refreshProvider(acting), refreshPlatform()]);
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <div className="mx-auto max-w-7xl space-y-8">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-slate-500">
          <Link href="/" className="hover:text-slate-300">Dashboard</Link>
          <ChevronRight size={10} aria-hidden />
          <span className="text-slate-400">Apps</span>
          <ChevronRight size={10} aria-hidden />
          <span className="font-medium text-cyan-400">Data Marketplace</span>
        </nav>

        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
              <span className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-2.5 text-cyan-300">
                <Database size={22} />
              </span>
              Decentralized Data Marketplace
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Providers list datasets; buyers purchase quota-limited licenses. Queries stay private:
              only a SHA-256 commitment of <code className="font-mono text-slate-300">(query || nonce || buyer)</code> is recorded on-chain.
            </p>
          </div>
          <label className="text-xs text-slate-400">
            <span className="block font-semibold uppercase tracking-widest">Acting as</span>
            <input
              value={acting}
              onChange={(e) => setActing(e.target.value.trim())}
              spellCheck={false}
              className="mt-1 w-full min-w-[18rem] rounded-xl border border-white/10 bg-slate-900 px-3 py-2 font-mono text-[11px] text-white"
              aria-label="Active wallet address"
            />
          </label>
        </header>

        {platform && (
          <section
            aria-label="Platform analytics"
            className="grid grid-cols-2 gap-3 rounded-3xl border border-white/5 bg-white/5 p-4 md:grid-cols-4 lg:grid-cols-6"
          >
            <PlatformStat label="Providers" value={platform.providers} />
            <PlatformStat label="Datasets" value={platform.datasets} />
            <PlatformStat label="Active listings" value={platform.activeListings} />
            <PlatformStat label="Buyers" value={platform.buyers} />
            <PlatformStat label="Lifetime revenue" value={platform.totalRevenue} />
            <PlatformStat label="Queries served" value={platform.totalQueries} />
          </section>
        )}

        <DataMarketplacePanel
          acting={acting}
          provider={provider}
          datasets={datasets}
          myDatasets={myDatasets}
          myLicenses={myLicenses}
          selectedDataset={selectedDataset}
          selectedStats={selectedStats}
          recentReceipts={recentReceipts}
          onRegisterProvider={handleRegisterProvider}
          onListDataset={handleListDataset}
          onSelectDataset={handleSelectDataset}
          onPurchase={handlePurchase}
          onSubmitQuery={handleSubmitQuery}
          onDelist={handleDelist}
          isLoading={isLoading}
          error={error}
        />
      </div>
    </div>
  );
}

const PlatformStat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
    <p className="text-lg font-bold text-white">{value.toLocaleString()}</p>
  </div>
);
