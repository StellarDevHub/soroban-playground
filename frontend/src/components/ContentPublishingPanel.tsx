"use client";

import React, { useMemo, useState } from "react";
import {
  BookOpen,
  Coins,
  Crown,
  Eye,
  Heart,
  PenSquare,
  PlusCircle,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";

export type AuthorProfile = {
  address: string;
  name: string;
  bio: string;
  subscriptionPrice: number;
  periodSeconds: number;
};

export type Article = {
  id: number;
  author: string;
  authorName?: string;
  title: string;
  contentHash: string;
  premium: boolean;
  timestamp: number;
  views: number;
  likes: number;
  tipsCollected: number;
};

export type AuthorStats = {
  articleCount: number;
  totalViews: number;
  totalLikes: number;
  totalTips: number;
  activeSubscribers: number;
  lifetimeSubscribers: number;
  subscriptionRevenue: number;
};

export type SubscriberRow = {
  subscriber: string;
  startedAt: number;
  expiresAt: number;
  totalPaid: number;
  active: boolean;
};

interface ContentPublishingPanelProps {
  profile?: AuthorProfile;
  articles: Article[];
  feed: Article[];
  stats?: AuthorStats;
  subscribers: SubscriberRow[];
  onRegister: (input: { name: string; bio: string; subscriptionPrice: number; periodSeconds: number }) => Promise<void>;
  onPublish: (input: { title: string; contentHash: string; premium: boolean }) => Promise<void>;
  onTip: (articleId: number, amount: number) => Promise<void>;
  onLike: (articleId: number) => Promise<void>;
  onSubscribe: (author: string, periods: number) => Promise<void>;
  isLoading?: boolean;
  error?: string;
}

const fmtTime = (ts: number) => {
  const seconds = Math.floor(Date.now() / 1000) - ts;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
};

const fmtNumber = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : `${n}`;

const ContentPublishingPanel: React.FC<ContentPublishingPanelProps> = ({
  profile,
  articles,
  feed,
  stats,
  subscribers,
  onRegister,
  onPublish,
  onTip,
  onLike,
  onSubscribe,
  isLoading,
  error,
}) => {
  const [tab, setTab] = useState<"feed" | "studio" | "analytics">("feed");
  const [showRegister, setShowRegister] = useState(!profile);

  const [regName, setRegName] = useState("");
  const [regBio, setRegBio] = useState("");
  const [regPrice, setRegPrice] = useState("0");
  const [regPeriod, setRegPeriod] = useState("2592000");
  const [submitting, setSubmitting] = useState(false);

  const [postTitle, setPostTitle] = useState("");
  const [postHash, setPostHash] = useState("");
  const [postPremium, setPostPremium] = useState(false);

  const conversionRate = useMemo(() => {
    if (!stats || stats.totalViews === 0) return 0;
    return (stats.activeSubscribers / stats.totalViews) * 100;
  }, [stats]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim()) return;
    setSubmitting(true);
    try {
      await onRegister({
        name: regName.trim(),
        bio: regBio.trim(),
        subscriptionPrice: Number(regPrice) || 0,
        periodSeconds: Number(regPeriod) || 2_592_000,
      });
      setShowRegister(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!postTitle.trim() || !postHash.trim()) return;
    setSubmitting(true);
    try {
      await onPublish({ title: postTitle.trim(), contentHash: postHash.trim(), premium: postPremium });
      setPostTitle("");
      setPostHash("");
      setPostPremium(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {error}
        </div>
      )}

      {profile ? (
        <header className="rounded-3xl border border-violet-500/20 bg-gradient-to-r from-violet-900/40 to-indigo-900/40 p-6 backdrop-blur-xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-violet-300">Author</p>
              <h2 className="mt-1 text-2xl font-bold text-white">{profile.name}</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-300">{profile.bio}</p>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
              <Stat label="Articles" value={fmtNumber(stats?.articleCount ?? 0)} icon={<BookOpen size={14} />} />
              <Stat label="Subscribers" value={fmtNumber(stats?.activeSubscribers ?? 0)} icon={<Users size={14} />} />
              <Stat label="Tips" value={fmtNumber(stats?.totalTips ?? 0)} icon={<Coins size={14} />} />
            </dl>
          </div>
        </header>
      ) : (
        <button
          onClick={() => setShowRegister(true)}
          className="flex w-full items-center justify-center gap-2 rounded-3xl border border-dashed border-violet-500/40 bg-violet-500/5 px-6 py-8 text-sm font-medium text-violet-200 transition hover:bg-violet-500/10"
        >
          <UserPlus size={18} />
          Register as an author to start publishing
        </button>
      )}

      <nav role="tablist" aria-label="Content publishing sections" className="flex gap-2">
        {(["feed", "studio", "analytics"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wider transition ${
              tab === t
                ? "bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/40"
                : "bg-white/5 text-slate-400 hover:bg-white/10"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "feed" && (
        <section aria-label="Article feed" className="space-y-4">
          {feed.length === 0 ? (
            <EmptyState message="No articles published yet. Be the first to share something." />
          ) : (
            feed.map((article) => (
              <ArticleCard
                key={article.id}
                article={article}
                onTip={(amount) => onTip(article.id, amount)}
                onLike={() => onLike(article.id)}
                onSubscribe={(periods) => onSubscribe(article.author, periods)}
              />
            ))
          )}
        </section>
      )}

      {tab === "studio" && (
        <section aria-label="Author studio" className="space-y-6">
          {profile ? (
            <form
              onSubmit={handlePublish}
              className="space-y-4 rounded-3xl border border-white/5 bg-slate-900/40 p-6"
            >
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <PenSquare size={16} /> Publish a new article
              </h3>
              <Field label="Title" htmlFor="cp-title">
                <input
                  id="cp-title"
                  value={postTitle}
                  onChange={(e) => setPostTitle(e.target.value)}
                  maxLength={200}
                  required
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </Field>
              <Field label="Content hash (32-byte hex)" htmlFor="cp-hash">
                <input
                  id="cp-hash"
                  value={postHash}
                  onChange={(e) => setPostHash(e.target.value)}
                  pattern="[A-Fa-f0-9]{64}"
                  placeholder="64 hex characters referencing your IPFS / S3 / arweave content"
                  required
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
                />
              </Field>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={postPremium}
                  onChange={(e) => setPostPremium(e.target.checked)}
                  className="h-4 w-4 rounded border-white/10 bg-slate-950"
                />
                Premium — readers must subscribe
              </label>
              <button
                type="submit"
                disabled={submitting || isLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-50"
              >
                <PlusCircle size={14} />
                {submitting ? "Publishing…" : "Publish"}
              </button>
            </form>
          ) : (
            <EmptyState message="Register as an author to access the studio." />
          )}

          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Your articles</h3>
            {articles.length === 0 ? (
              <EmptyState message="No articles yet." />
            ) : (
              articles.map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  onTip={(amount) => onTip(article.id, amount)}
                  onLike={() => onLike(article.id)}
                  onSubscribe={(periods) => onSubscribe(article.author, periods)}
                  compact
                />
              ))
            )}
          </div>
        </section>
      )}

      {tab === "analytics" && (
        <section aria-label="Subscriber analytics" className="space-y-6">
          {!stats ? (
            <EmptyState message="Analytics will appear after you publish your first article." />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <MetricCard label="Total views" value={fmtNumber(stats.totalViews)} icon={<Eye size={16} />} accent="text-sky-300" />
                <MetricCard label="Likes" value={fmtNumber(stats.totalLikes)} icon={<Heart size={16} />} accent="text-rose-300" />
                <MetricCard label="Tips" value={fmtNumber(stats.totalTips)} icon={<Coins size={16} />} accent="text-amber-300" />
                <MetricCard
                  label="View → sub rate"
                  value={`${conversionRate.toFixed(2)}%`}
                  icon={<TrendingUp size={16} />}
                  accent="text-emerald-300"
                />
              </div>

              <div className="rounded-3xl border border-white/5 bg-slate-900/40 p-6">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
                  <Users size={14} /> Subscribers ({subscribers.length})
                </h3>
                {subscribers.length === 0 ? (
                  <EmptyState message="No subscribers yet." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <caption className="sr-only">List of subscribers with subscription details</caption>
                      <thead className="text-[10px] uppercase tracking-widest text-slate-400">
                        <tr>
                          <th scope="col" className="px-3 py-2">Subscriber</th>
                          <th scope="col" className="px-3 py-2">Started</th>
                          <th scope="col" className="px-3 py-2">Expires</th>
                          <th scope="col" className="px-3 py-2">Paid</th>
                          <th scope="col" className="px-3 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-300">
                        {subscribers.map((row) => (
                          <tr key={row.subscriber} className="border-t border-white/5">
                            <td className="px-3 py-2 font-mono text-[11px]">{shorten(row.subscriber)}</td>
                            <td className="px-3 py-2">{new Date(row.startedAt * 1000).toLocaleDateString()}</td>
                            <td className="px-3 py-2">{new Date(row.expiresAt * 1000).toLocaleDateString()}</td>
                            <td className="px-3 py-2">{row.totalPaid}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  row.active ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700/40 text-slate-400"
                                }`}
                              >
                                {row.active ? "Active" : "Expired"}
                              </span>
                            </td>
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

      {showRegister && !profile && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cp-register-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm"
        >
          <form
            onSubmit={handleRegister}
            className="w-full max-w-md space-y-4 rounded-3xl border border-violet-500/30 bg-slate-900 p-6"
          >
            <h3 id="cp-register-title" className="text-base font-bold text-white">
              Register as an author
            </h3>
            <Field label="Display name" htmlFor="cp-reg-name">
              <input
                id="cp-reg-name"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                required
                maxLength={64}
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </Field>
            <Field label="Bio" htmlFor="cp-reg-bio">
              <textarea
                id="cp-reg-bio"
                value={regBio}
                onChange={(e) => setRegBio(e.target.value)}
                maxLength={512}
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                rows={3}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Subscription price" htmlFor="cp-reg-price">
                <input
                  id="cp-reg-price"
                  type="number"
                  min="0"
                  value={regPrice}
                  onChange={(e) => setRegPrice(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </Field>
              <Field label="Period (seconds)" htmlFor="cp-reg-period">
                <input
                  id="cp-reg-period"
                  type="number"
                  min="1"
                  value={regPeriod}
                  onChange={(e) => setRegPeriod(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRegister(false)}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {submitting ? "Registering…" : "Register"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

// ── Helpers ────────────────────────────────────────────────────────────────

const Stat: React.FC<{ label: string; value: string; icon: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-2">
    <dt className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-slate-400">
      {icon}
      {label}
    </dt>
    <dd className="text-base font-bold text-white">{value}</dd>
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

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-10 text-center text-sm text-slate-400">
    {message}
  </div>
);

const shorten = (addr: string) => (addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr);

interface ArticleCardProps {
  article: Article;
  onTip: (amount: number) => Promise<void>;
  onLike: () => Promise<void>;
  onSubscribe: (periods: number) => Promise<void>;
  compact?: boolean;
}

const ArticleCard: React.FC<ArticleCardProps> = ({ article, onTip, onLike, onSubscribe, compact }) => {
  const [tipAmount, setTipAmount] = useState("100");
  const [busy, setBusy] = useState<"tip" | "like" | "sub" | null>(null);

  const tip = async () => {
    const amount = Number(tipAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setBusy("tip");
    try {
      await onTip(amount);
    } finally {
      setBusy(null);
    }
  };

  const like = async () => {
    setBusy("like");
    try {
      await onLike();
    } finally {
      setBusy(null);
    }
  };

  const subscribe = async () => {
    setBusy("sub");
    try {
      await onSubscribe(1);
    } finally {
      setBusy(null);
    }
  };

  return (
    <article
      className={`rounded-3xl border border-white/5 bg-slate-900/40 ${compact ? "p-4" : "p-6"} backdrop-blur-sm`}
      aria-labelledby={`article-${article.id}-title`}
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          <h4 id={`article-${article.id}-title`} className="text-base font-bold text-white">
            {article.title}
          </h4>
          <p className="text-xs text-slate-400">
            By <span className="font-mono">{article.authorName ?? shorten(article.author)}</span> · {fmtTime(article.timestamp)}
          </p>
        </div>
        {article.premium && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
            <Crown size={10} /> Premium
          </span>
        )}
      </header>
      <p className="mt-2 truncate font-mono text-[11px] text-slate-500">hash: {article.contentHash}</p>

      <footer className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-300">
        <span className="inline-flex items-center gap-1"><Eye size={12} /> {fmtNumber(article.views)}</span>
        <span className="inline-flex items-center gap-1"><Heart size={12} /> {fmtNumber(article.likes)}</span>
        <span className="inline-flex items-center gap-1"><Coins size={12} /> {fmtNumber(article.tipsCollected)}</span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={like}
            disabled={busy === "like"}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold hover:bg-white/10 disabled:opacity-50"
            aria-label={`Like ${article.title}`}
          >
            <Heart size={12} className="inline" /> Like
          </button>
          <label className="sr-only" htmlFor={`tip-${article.id}`}>
            Tip amount for {article.title}
          </label>
          <input
            id={`tip-${article.id}`}
            type="number"
            min="1"
            value={tipAmount}
            onChange={(e) => setTipAmount(e.target.value)}
            className="w-20 rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-[11px] text-white"
          />
          <button
            type="button"
            onClick={tip}
            disabled={busy === "tip"}
            className="rounded-lg bg-amber-500/20 px-2 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/30 disabled:opacity-50"
          >
            Tip
          </button>
          {article.premium && (
            <button
              type="button"
              onClick={subscribe}
              disabled={busy === "sub"}
              className="rounded-lg bg-violet-500/30 px-2 py-1 text-[11px] font-semibold text-violet-100 hover:bg-violet-500/40 disabled:opacity-50"
            >
              Subscribe
            </button>
          )}
        </div>
      </footer>
    </article>
  );
};

export default ContentPublishingPanel;
