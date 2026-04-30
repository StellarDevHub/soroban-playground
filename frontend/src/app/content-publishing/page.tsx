"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, BookOpen } from "lucide-react";
import ContentPublishingPanel, {
  Article,
  AuthorProfile,
  AuthorStats,
  SubscriberRow,
} from "@/components/ContentPublishingPanel";

type PlatformAnalytics = {
  authors: number;
  articles: number;
  activeSubscriptions: number;
  totalTips: number;
  totalViews: number;
  totalLikes: number;
};

const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:5000";
const API = `${API_BASE}/api/content`;

const FALLBACK_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    throw new Error(body?.message || `Request failed: ${res.status}`);
  }
  return (body?.data ?? body) as T;
}

export default function ContentPublishingPage() {
  const [address, setAddress] = useState<string>(FALLBACK_ADDRESS);
  const [profile, setProfile] = useState<AuthorProfile | undefined>(undefined);
  const [articles, setArticles] = useState<Article[]>([]);
  const [feed, setFeed] = useState<Article[]>([]);
  const [stats, setStats] = useState<AuthorStats | undefined>(undefined);
  const [subscribers, setSubscribers] = useState<SubscriberRow[]>([]);
  const [platform, setPlatform] = useState<PlatformAnalytics | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);

  const refreshFeed = useCallback(async () => {
    try {
      const data = await jsonOrThrow<Article[]>(await fetch(`${API}/articles/latest?limit=20`));
      setFeed(data);
    } catch (err) {
      console.warn("feed unavailable", err);
    }
  }, []);

  const refreshAuthor = useCallback(async (addr: string) => {
    if (!addr) return;
    try {
      const data = await jsonOrThrow<AuthorProfile>(await fetch(`${API}/authors/${addr}`));
      setProfile(data);
      const [a, s, subs] = await Promise.all([
        jsonOrThrow<Article[]>(await fetch(`${API}/authors/${addr}/articles`)),
        jsonOrThrow<AuthorStats>(await fetch(`${API}/authors/${addr}/analytics`)),
        jsonOrThrow<SubscriberRow[]>(await fetch(`${API}/authors/${addr}/subscribers`)),
      ]);
      setArticles(a);
      setStats(s);
      setSubscribers(subs);
    } catch (err) {
      // If the author isn't registered yet, just clear local state quietly.
      if (err instanceof Error && /not found/i.test(err.message)) {
        setProfile(undefined);
        setArticles([]);
        setStats(undefined);
        setSubscribers([]);
        return;
      }
      console.warn("author refresh failed", err);
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
    refreshFeed();
    refreshPlatform();
  }, [refreshFeed, refreshPlatform]);

  useEffect(() => {
    refreshAuthor(address);
  }, [address, refreshAuthor]);

  const handleRegister: React.ComponentProps<typeof ContentPublishingPanel>["onRegister"] = async (input) => {
    setIsLoading(true);
    setError(undefined);
    try {
      const data = await jsonOrThrow<AuthorProfile>(
        await fetch(`${API}/authors`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, ...input }),
        })
      );
      setProfile(data);
      await refreshAuthor(address);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePublish: React.ComponentProps<typeof ContentPublishingPanel>["onPublish"] = async (input) => {
    setIsLoading(true);
    setError(undefined);
    try {
      await jsonOrThrow<Article>(
        await fetch(`${API}/articles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: address, ...input }),
        })
      );
      await Promise.all([refreshAuthor(address), refreshFeed(), refreshPlatform()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleTip: React.ComponentProps<typeof ContentPublishingPanel>["onTip"] = async (id, amount) => {
    setError(undefined);
    try {
      await jsonOrThrow(
        await fetch(`${API}/articles/${id}/tip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: address, amount }),
        })
      );
      await Promise.all([refreshAuthor(address), refreshFeed()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tip failed");
    }
  };

  const handleLike: React.ComponentProps<typeof ContentPublishingPanel>["onLike"] = async (id) => {
    setError(undefined);
    try {
      await jsonOrThrow(
        await fetch(`${API}/articles/${id}/like`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reader: address }),
        })
      );
      await Promise.all([refreshAuthor(address), refreshFeed()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Like failed");
    }
  };

  const handleSubscribe: React.ComponentProps<typeof ContentPublishingPanel>["onSubscribe"] = async (
    author,
    periods
  ) => {
    setError(undefined);
    try {
      await jsonOrThrow(
        await fetch(`${API}/subscriptions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author, subscriber: address, periods }),
        })
      );
      await Promise.all([refreshAuthor(address), refreshPlatform()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Subscribe failed");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-8">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-slate-500">
          <Link href="/" className="hover:text-slate-300">Dashboard</Link>
          <ChevronRight size={10} aria-hidden />
          <span className="text-slate-400">Apps</span>
          <ChevronRight size={10} aria-hidden />
          <span className="font-medium text-violet-400">Content Publishing</span>
        </nav>

        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
              <span className="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-2.5 text-violet-300">
                <BookOpen size={22} />
              </span>
              Decentralized Content Publishing
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Publish articles, accept tips, and sell subscriptions on Soroban. Off-chain content is
              addressed by hash; tips and subscriber analytics are settled on-chain.
            </p>
          </div>
          <label className="text-xs text-slate-400">
            <span className="block font-semibold uppercase tracking-widest">Acting as</span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value.trim())}
              spellCheck={false}
              className="mt-1 w-full min-w-[18rem] rounded-xl border border-white/10 bg-slate-900 px-3 py-2 font-mono text-[11px] text-white"
              aria-label="Active wallet address"
            />
          </label>
        </header>

        {platform && (
          <section
            aria-label="Platform analytics"
            className="grid grid-cols-2 gap-3 rounded-3xl border border-white/5 bg-white/5 p-4 md:grid-cols-4"
          >
            <PlatformStat label="Authors" value={platform.authors} />
            <PlatformStat label="Articles" value={platform.articles} />
            <PlatformStat label="Active subscriptions" value={platform.activeSubscriptions} />
            <PlatformStat label="Lifetime tips" value={platform.totalTips} />
          </section>
        )}

        <ContentPublishingPanel
          profile={profile}
          articles={articles}
          feed={feed}
          stats={stats}
          subscribers={subscribers}
          onRegister={handleRegister}
          onPublish={handlePublish}
          onTip={handleTip}
          onLike={handleLike}
          onSubscribe={handleSubscribe}
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
