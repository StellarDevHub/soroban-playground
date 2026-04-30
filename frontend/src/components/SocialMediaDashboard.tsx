"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Coins,
  Crown,
  Heart,
  Loader2,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  Star,
  TrendingUp,
  User,
  UserCheck,
  UserPlus,
  Wallet,
  Zap,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SocialProfile {
  address: string;
  nickname: string;
  bio: string;
  followers: number;
  following: number;
  postCount: number;
}

export interface SocialPost {
  id: number;
  author: string;
  contentHash: string;
  timestamp: number;
  likes: number;
  tipsCollected: number;
  isPremium: boolean;
  minTip: number;
  authorProfile?: SocialProfile | null;
}

export interface CreatorAnalytics {
  address: string;
  postCount: number;
  totalTips: number;
  totalLikes: number;
  subscriberCount: number;
  followerCount: number;
  withdrawableEarnings: number;
}

export interface GlobalStats {
  totalProfiles: number;
  totalPosts: number;
  totalLikes: number;
  totalTips: number;
  totalSubscriptions: number;
  totalSubscriptionRevenue: number;
}

interface SocialMediaDashboardProps {
  contractId?: string;
  walletAddress?: string;
  apiBase?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_API = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:5000";

function timeAgo(ts: number) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function shortenAddr(addr: string) {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr;
}

// ---------------------------------------------------------------------------
// PostCard — stable component identity
// ---------------------------------------------------------------------------

interface PostCardProps {
  post: SocialPost;
  caller: string;
  onLike: (id: number) => void;
  onTip: (id: number, amount: number) => void;
  onSubscribe: (creator: string) => void;
  subscribedCreators: Set<string>;
}

function PostCard({ post, caller, onLike, onTip, onSubscribe, subscribedCreators }: PostCardProps) {
  const [tipAmount, setTipAmount] = useState(String(post.minTip || 100));
  const [showTip, setShowTip] = useState(false);
  const isSubscribed = subscribedCreators.has(post.author);

  return (
    <div className={`p-4 rounded-xl border ${post.isPremium ? "border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-900/10" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"}`}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-sm text-slate-900 dark:text-white">
              {post.authorProfile?.nickname ?? shortenAddr(post.author)}
            </span>
            {post.isPremium && (
              <span className="flex items-center gap-0.5 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full">
                <Crown className="w-3 h-3" /> Premium
              </span>
            )}
            <span className="text-xs text-slate-400 ml-auto">{timeAgo(post.timestamp)}</span>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300 font-mono break-all mb-3">
            {post.contentHash}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onLike(post.id)}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition-colors"
            >
              <Heart className="w-3.5 h-3.5" /> {post.likes}
            </button>
            <span className="flex items-center gap-1 text-xs text-slate-400">
              <Coins className="w-3.5 h-3.5" /> {post.tipsCollected.toLocaleString()} str
            </span>
            {post.minTip > 0 && (
              <span className="text-xs text-slate-400">min tip: {post.minTip.toLocaleString()}</span>
            )}
            <div className="ml-auto flex items-center gap-1">
              {post.isPremium && !isSubscribed ? (
                <button
                  onClick={() => onSubscribe(post.author)}
                  className="flex items-center gap-1 text-xs bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 rounded-lg transition-colors"
                >
                  <Star className="w-3 h-3" /> Subscribe to Tip
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setShowTip(s => !s)}
                    className="flex items-center gap-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 rounded-lg transition-colors"
                  >
                    <Zap className="w-3 h-3" /> Tip
                  </button>
                  {showTip && (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        className="w-20 text-xs px-2 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        value={tipAmount}
                        onChange={e => setTipAmount(e.target.value)}
                      />
                      <button
                        onClick={() => { onTip(post.id, Number(tipAmount)); setShowTip(false); }}
                        className="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded transition-colors"
                      >
                        Send
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreatorRow — stable component identity
// ---------------------------------------------------------------------------

interface CreatorRowProps {
  rank: number;
  analytics: CreatorAnalytics;
  profile?: SocialProfile;
  caller: string;
  isFollowing: boolean;
  isSubscribed: boolean;
  onFollow: (creator: string) => void;
  onSubscribe: (creator: string) => void;
}

function CreatorRow({ rank, analytics, profile, caller, isFollowing, isSubscribed, onFollow, onSubscribe }: CreatorRowProps) {
  return (
    <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${rank === 1 ? "bg-amber-400 text-white" : rank === 2 ? "bg-slate-300 text-slate-700" : rank === 3 ? "bg-orange-300 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-500"}`}>
        {rank}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
            {profile?.nickname ?? shortenAddr(analytics.address)}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
          <span><span className="font-medium text-slate-600 dark:text-slate-300">{analytics.followerCount}</span> followers</span>
          <span><span className="font-medium text-slate-600 dark:text-slate-300">{analytics.subscriberCount}</span> subs</span>
          <span><span className="font-medium text-green-600">{analytics.withdrawableEarnings.toLocaleString()}</span> str</span>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {caller !== analytics.address && (
          <>
            <button
              onClick={() => onFollow(analytics.address)}
              className={`text-xs px-2 py-1 rounded-lg transition-colors ${isFollowing ? "bg-slate-200 dark:bg-slate-700 text-slate-500" : "bg-violet-600 hover:bg-violet-700 text-white"}`}
            >
              {isFollowing ? "Following" : <><UserPlus className="w-3 h-3 inline mr-0.5" />Follow</>}
            </button>
            <button
              onClick={() => onSubscribe(analytics.address)}
              className={`text-xs px-2 py-1 rounded-lg transition-colors ${isSubscribed ? "bg-slate-200 dark:bg-slate-700 text-slate-500" : "bg-amber-500 hover:bg-amber-600 text-white"}`}
            >
              {isSubscribed ? <><Star className="w-3 h-3 inline mr-0.5" />Subscribed</> : "Subscribe"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export default function SocialMediaDashboard({ contractId, walletAddress, apiBase = DEFAULT_API }: SocialMediaDashboardProps) {
  const [tab, setTab] = useState<"feed" | "create" | "analytics" | "creators">("feed");
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [leaderboard, setLeaderboard] = useState<CreatorAnalytics[]>([]);
  const [myAnalytics, setMyAnalytics] = useState<CreatorAnalytics | null>(null);
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
  const [myProfile, setMyProfile] = useState<SocialProfile | null>(null);
  const [subscribedCreators, setSubscribedCreators] = useState<Set<string>>(new Set());
  const [followingCreators, setFollowingCreators] = useState<Set<string>>(new Set());

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Profile form
  const [caller, setCaller] = useState(walletAddress ?? "");
  const [profileNickname, setProfileNickname] = useState("");
  const [profileBio, setProfileBio] = useState("");

  // Post form
  const [postContent, setPostContent] = useState("");
  const [postIsPremium, setPostIsPremium] = useState(false);
  const [postMinTip, setPostMinTip] = useState("0");

  // Subscribe form
  const [subTarget, setSubTarget] = useState("");
  const [subAmount, setSubAmount] = useState("500");

  // Withdraw
  const [leaderboardBy, setLeaderboardBy] = useState("earnings");

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (walletAddress) {
      setCaller(a => a || walletAddress);
    }
  }, [walletAddress]);

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  const apiCall = useCallback(async (path: string, method = "GET", body?: object) => {
    const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${apiBase}/api/social${path}`, opts);
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.message ?? "Request failed");
    return json;
  }, [apiBase]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [postsRes, statsRes, lbRes] = await Promise.allSettled([
        apiCall("/posts?limit=30"),
        apiCall("/stats"),
        apiCall(`/leaderboard?by=${leaderboardBy}&limit=10`),
      ]);

      if (postsRes.status === "fulfilled") setPosts(postsRes.value.data ?? []);
      if (statsRes.status === "fulfilled") setGlobalStats(statsRes.value.data);
      if (lbRes.status === "fulfilled") setLeaderboard(lbRes.value.data ?? []);

      if (caller) {
        const [profileRes, analyticsRes] = await Promise.allSettled([
          apiCall(`/profiles/${caller}`),
          apiCall(`/analytics/${caller}`),
        ]);
        if (profileRes.status === "fulfilled") setMyProfile(profileRes.value.data);
        else setMyProfile(null);
        if (analyticsRes.status === "fulfilled") setMyAnalytics(analyticsRes.value.data);
      }
    } finally {
      setIsLoading(false);
    }
  }, [apiCall, caller, leaderboardBy]);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, 15_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [refresh]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function flash(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3500);
  }

  async function handleCreateProfile() {
    if (!caller) { setError("Enter your address"); return; }
    setError(null);
    try {
      await apiCall("/profiles", "POST", { address: caller, nickname: profileNickname, bio: profileBio });
      flash("Profile created");
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function handleCreatePost() {
    if (!postContent.trim()) { setError("Content is required"); return; }
    setError(null);
    try {
      await apiCall("/posts", "POST", {
        author: caller,
        contentHash: postContent,
        isPremium: postIsPremium,
        minTip: Number(postMinTip) || 0,
      });
      flash("Post published");
      setPostContent("");
      setTab("feed");
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function handleLike(postId: number) {
    setError(null);
    try {
      await apiCall(`/posts/${postId}/like`, "POST", { caller });
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Like failed"); }
  }

  async function handleTip(postId: number, amount: number) {
    setError(null);
    try {
      await apiCall(`/posts/${postId}/tip`, "POST", { caller, amount });
      flash(`Tipped ${amount} stroops`);
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Tip failed"); }
  }

  async function handleFollow(creator: string) {
    setError(null);
    const isFollowing = followingCreators.has(creator);
    try {
      if (isFollowing) {
        await apiCall("/unfollow", "POST", { follower: caller, creator });
        setFollowingCreators(s => { const n = new Set(s); n.delete(creator); return n; });
      } else {
        await apiCall("/follow", "POST", { follower: caller, creator });
        setFollowingCreators(s => new Set(s).add(creator));
        flash(`Following ${creator.slice(0, 8)}…`);
      }
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Follow failed"); }
  }

  async function handleSubscribe(creator: string) {
    setError(null);
    try {
      await apiCall("/subscribe", "POST", { subscriber: caller, creator, amount: Number(subAmount) });
      setSubscribedCreators(s => new Set(s).add(creator));
      flash(`Subscribed to ${creator.slice(0, 8)}…`);
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Subscribe failed"); }
  }

  async function handleWithdraw() {
    setError(null);
    try {
      const r = await apiCall("/withdraw", "POST", { creator: caller });
      flash(`Withdrew ${r.data.withdrawn.toLocaleString()} stroops`);
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Withdraw failed"); }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const hasProfile = !!myProfile;

  return (
    <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg">
            <MessageSquarePlus className="w-6 h-6 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Social Media</h2>
            {contractId && <p className="text-xs text-slate-400 font-mono">{contractId.slice(0, 12)}…{contractId.slice(-6)}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {globalStats && (
            <span className="hidden sm:flex items-center gap-1 text-xs text-slate-400">
              <Activity className="w-3 h-3" /> {globalStats.totalProfiles} creators · {globalStats.totalPosts} posts
            </span>
          )}
          <button onClick={refresh} disabled={isLoading} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <RefreshCw className="w-4 h-4 text-slate-400" />}
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-start gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {successMsg}
        </div>
      )}

      {/* Caller + profile setup */}
      <div className="flex flex-wrap gap-2 mb-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
        <input
          className="flex-1 min-w-[200px] text-sm px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400"
          placeholder="Your wallet address"
          value={caller}
          onChange={e => setCaller(e.target.value)}
        />
        {!hasProfile && caller && (
          <div className="flex gap-2 w-full">
            <input className="flex-1 text-sm px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400" placeholder="Nickname" value={profileNickname} onChange={e => setProfileNickname(e.target.value)} />
            <input className="flex-1 text-sm px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400" placeholder="Bio" value={profileBio} onChange={e => setProfileBio(e.target.value)} />
            <button onClick={handleCreateProfile} className="flex items-center gap-1 bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg text-sm transition-colors">
              <User className="w-3.5 h-3.5" /> Create Profile
            </button>
          </div>
        )}
        {hasProfile && myProfile && (
          <div className="flex items-center gap-3 text-sm">
            <UserCheck className="w-4 h-4 text-green-500" />
            <span className="font-semibold text-slate-900 dark:text-white">{myProfile.nickname}</span>
            <span className="text-slate-400">{myProfile.followers} followers · {myProfile.following} following</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg w-fit overflow-x-auto">
        {(["feed", "create", "analytics", "creators"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${tab === t ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
          >
            {t === "feed" ? "Feed" : t === "create" ? "New Post" : t === "analytics" ? "My Analytics" : "Creators"}
          </button>
        ))}
      </div>

      {/* ── Feed ── */}
      {tab === "feed" && (
        <div className="space-y-3">
          {posts.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <MessageSquarePlus className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No posts yet. Be the first to publish.</p>
            </div>
          ) : (
            posts.map(p => (
              <PostCard
                key={p.id}
                post={p}
                caller={caller}
                onLike={handleLike}
                onTip={handleTip}
                onSubscribe={handleSubscribe}
                subscribedCreators={subscribedCreators}
              />
            ))
          )}
        </div>
      )}

      {/* ── Create post ── */}
      {tab === "create" && (
        <div className="space-y-4 max-w-lg">
          {!hasProfile && <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg">Create a profile first to publish posts.</div>}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Content / IPFS hash</label>
            <textarea
              rows={3}
              className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 resize-none"
              placeholder="Your post content or IPFS hash…"
              value={postContent}
              onChange={e => setPostContent(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={postIsPremium} onChange={e => setPostIsPremium(e.target.checked)} className="rounded" />
              <Crown className="w-3.5 h-3.5 text-amber-500" /> Premium (subscribers only)
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Minimum tip (stroops, 0 = any)</label>
            <input type="number" className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" value={postMinTip} onChange={e => setPostMinTip(e.target.value)} />
          </div>
          <button onClick={handleCreatePost} disabled={!hasProfile} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" /> Publish
          </button>
        </div>
      )}

      {/* ── Analytics ── */}
      {tab === "analytics" && (
        <div className="space-y-6">
          {!hasProfile ? (
            <div className="text-center py-12 text-slate-400"><BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>Create a profile to see your analytics.</p></div>
          ) : myAnalytics && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { label: "Posts", value: myAnalytics.postCount, color: "text-slate-900 dark:text-white", icon: <MessageSquarePlus className="w-4 h-4" /> },
                  { label: "Followers", value: myAnalytics.followerCount, color: "text-violet-600", icon: <UserPlus className="w-4 h-4" /> },
                  { label: "Subscribers", value: myAnalytics.subscriberCount, color: "text-amber-500", icon: <Star className="w-4 h-4" /> },
                  { label: "Total Likes", value: myAnalytics.totalLikes, color: "text-red-500", icon: <Heart className="w-4 h-4" /> },
                  { label: "Total Tips", value: `${myAnalytics.totalTips.toLocaleString()} str`, color: "text-green-600", icon: <Coins className="w-4 h-4" /> },
                  { label: "Withdrawable", value: `${myAnalytics.withdrawableEarnings.toLocaleString()} str`, color: "text-indigo-600", icon: <Wallet className="w-4 h-4" /> },
                ].map(({ label, value, color, icon }) => (
                  <div key={label} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
                    <div className="flex items-center gap-2 text-xs text-slate-500 uppercase tracking-wider mb-2">{icon}{label}</div>
                    <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Earn & Subscribe panel */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Withdraw */}
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Withdraw Earnings</div>
                  <div className="text-3xl font-bold text-green-600 font-mono mb-4">{myAnalytics.withdrawableEarnings.toLocaleString()} str</div>
                  <button onClick={handleWithdraw} disabled={myAnalytics.withdrawableEarnings === 0} className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm transition-colors">
                    <Wallet className="w-4 h-4" /> Withdraw
                  </button>
                </div>

                {/* Subscribe to another creator */}
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Subscribe to Creator</div>
                  <div className="space-y-2">
                    <input className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400" placeholder="Creator address" value={subTarget} onChange={e => setSubTarget(e.target.value)} />
                    <div className="flex gap-2">
                      <input type="number" className="flex-1 text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Amount (stroops)" value={subAmount} onChange={e => setSubAmount(e.target.value)} />
                      <button onClick={() => subTarget && handleSubscribe(subTarget)} className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded-lg text-sm transition-colors">
                        <Star className="w-3.5 h-3.5" /> Sub
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Global stats */}
          {globalStats && (
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Platform Stats</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                {[
                  ["Creators", globalStats.totalProfiles],
                  ["Posts", globalStats.totalPosts],
                  ["Total Likes", globalStats.totalLikes],
                  ["Total Tips", `${globalStats.totalTips.toLocaleString()} str`],
                  ["Subscriptions", globalStats.totalSubscriptions],
                  ["Sub Revenue", `${globalStats.totalSubscriptionRevenue.toLocaleString()} str`],
                ].map(([label, val]) => (
                  <div key={String(label)}>
                    <div className="text-xs text-slate-400 uppercase tracking-wide">{label}</div>
                    <div className="font-bold text-slate-900 dark:text-white">{val}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Creators leaderboard ── */}
      {tab === "creators" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-slate-500">Sort by:</span>
            {(["earnings", "followers", "subscribers", "posts", "likes"] as const).map(by => (
              <button key={by} onClick={() => { setLeaderboardBy(by); }} className={`text-xs px-3 py-1 rounded-full transition-colors ${leaderboardBy === by ? "bg-violet-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-700"}`}>
                {by.charAt(0).toUpperCase() + by.slice(1)}
              </button>
            ))}
          </div>

          {leaderboard.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No creators yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {leaderboard.map((analytics, idx) => (
                <CreatorRow
                  key={analytics.address}
                  rank={idx + 1}
                  analytics={analytics}
                  profile={analytics.address === caller ? myProfile ?? undefined : undefined}
                  caller={caller}
                  isFollowing={followingCreators.has(analytics.address)}
                  isSubscribed={subscribedCreators.has(analytics.address)}
                  onFollow={handleFollow}
                  onSubscribe={handleSubscribe}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
