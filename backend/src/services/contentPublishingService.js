// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// In-memory mirror of the on-chain content-publishing state. The Rust contract
// is the source of truth — this service caches projections (latest feed,
// per-author analytics, subscriber rosters) so the frontend doesn't pay an RPC
// round-trip per render.
//
// A real deployment would back this with the indexer / Postgres; the surface
// area here is intentionally narrow so swapping the store is mechanical.

import { EventEmitter } from 'events';

const DEFAULT_PERIOD_SECONDS = 30 * 24 * 60 * 60; // 30 days

const nowSec = () => Math.floor(Date.now() / 1000);

class ContentPublishingService extends EventEmitter {
  constructor() {
    super();
    this.authors = new Map();        // address -> author profile
    this.articles = new Map();       // id -> article
    this.subscriptions = new Map();  // `${author}|${subscriber}` -> sub
    this.likes = new Map();          // `${articleId}|${reader}` -> true
    this.authorArticles = new Map(); // author -> Set<id>
    this.authorSubscribers = new Map(); // author -> Set<subscriber>
    this.latestIds = [];             // bounded ring (most recent first)
    this.LATEST_CAP = 50;
    this.nextId = 1;
  }

  // ── Authors ──────────────────────────────────────────────────────────────

  registerAuthor({ address, name, bio, subscriptionPrice, periodSeconds }) {
    if (!address) throw httpError(400, 'address is required');
    if (!name) throw httpError(400, 'name is required');
    if (this.authors.has(address)) {
      throw httpError(409, 'Author already registered');
    }
    if (subscriptionPrice != null && Number(subscriptionPrice) < 0) {
      throw httpError(400, 'subscriptionPrice must be >= 0');
    }
    const profile = {
      address,
      name,
      bio: bio || '',
      subscriptionPrice: Number(subscriptionPrice ?? 0),
      periodSeconds: Number(periodSeconds ?? DEFAULT_PERIOD_SECONDS),
      createdAt: nowSec(),
      stats: emptyStats(),
    };
    this.authors.set(address, profile);
    this.authorArticles.set(address, new Set());
    this.authorSubscribers.set(address, new Set());
    this.emit('author:registered', profile);
    return profile;
  }

  updateAuthor(address, updates) {
    const profile = this.requireAuthor(address);
    if (updates.name !== undefined) profile.name = updates.name;
    if (updates.bio !== undefined) profile.bio = updates.bio;
    if (updates.subscriptionPrice !== undefined) {
      const v = Number(updates.subscriptionPrice);
      if (v < 0) throw httpError(400, 'subscriptionPrice must be >= 0');
      profile.subscriptionPrice = v;
    }
    if (updates.periodSeconds !== undefined) {
      profile.periodSeconds = Math.max(1, Number(updates.periodSeconds));
    }
    this.emit('author:updated', profile);
    return profile;
  }

  getAuthor(address) {
    return this.authors.get(address) || null;
  }

  // ── Articles ─────────────────────────────────────────────────────────────

  publish({ author, title, contentHash, premium = false }) {
    const profile = this.requireAuthor(author);
    if (!title) throw httpError(400, 'title is required');
    if (!contentHash) throw httpError(400, 'contentHash is required');

    const id = this.nextId++;
    const article = {
      id,
      author,
      authorName: profile.name,
      title,
      contentHash,
      premium: Boolean(premium),
      timestamp: nowSec(),
      views: 0,
      likes: 0,
      tipsCollected: 0,
    };
    this.articles.set(id, article);
    this.authorArticles.get(author).add(id);
    profile.stats.articleCount += 1;

    this.latestIds.unshift(id);
    if (this.latestIds.length > this.LATEST_CAP) this.latestIds.pop();

    this.emit('article:published', article);
    return article;
  }

  getArticle(id) {
    const article = this.articles.get(Number(id));
    if (!article) throw httpError(404, 'Article not found');
    return article;
  }

  recordView({ articleId, reader }) {
    const article = this.getArticle(articleId);
    if (article.premium && reader !== article.author) {
      if (!this.hasActiveSubscription(article.author, reader)) {
        throw httpError(403, 'Premium content requires an active subscription');
      }
    }
    article.views += 1;
    const profile = this.authors.get(article.author);
    if (profile) profile.stats.totalViews += 1;
    this.emit('article:viewed', { article, reader });
    return article;
  }

  like({ articleId, reader }) {
    const article = this.getArticle(articleId);
    const key = `${article.id}|${reader}`;
    if (this.likes.has(key)) throw httpError(409, 'Already liked');
    this.likes.set(key, true);
    article.likes += 1;
    const profile = this.authors.get(article.author);
    if (profile) profile.stats.totalLikes += 1;
    this.emit('article:liked', { article, reader });
    return article;
  }

  // ── Tip jar ──────────────────────────────────────────────────────────────

  tip({ articleId, from, amount }) {
    const article = this.getArticle(articleId);
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      throw httpError(400, 'amount must be a positive number');
    }
    if (from === article.author) {
      throw httpError(400, 'Authors cannot tip their own articles');
    }
    article.tipsCollected += value;
    const profile = this.authors.get(article.author);
    if (profile) profile.stats.totalTips += value;
    const event = { article, from, amount: value, timestamp: nowSec() };
    this.emit('article:tipped', event);
    return event;
  }

  // ── Subscriptions ────────────────────────────────────────────────────────

  subscribe({ author, subscriber, periods = 1 }) {
    const profile = this.requireAuthor(author);
    if (subscriber === author) {
      throw httpError(400, 'Authors cannot subscribe to themselves');
    }
    const p = Number(periods);
    if (!Number.isInteger(p) || p <= 0) {
      throw httpError(400, 'periods must be a positive integer');
    }
    const cost = profile.subscriptionPrice * p;
    const extension = profile.periodSeconds * p;
    const key = subKey(author, subscriber);
    const now = nowSec();
    const existing = this.subscriptions.get(key);
    const wasActive = existing && existing.expiresAt > now;

    const sub = wasActive
      ? {
          ...existing,
          expiresAt: existing.expiresAt + extension,
          totalPaid: existing.totalPaid + cost,
        }
      : {
          author,
          subscriber,
          startedAt: now,
          expiresAt: now + extension,
          totalPaid: cost,
        };
    this.subscriptions.set(key, sub);

    profile.stats.subscriptionRevenue += cost;
    if (!wasActive) {
      const roster = this.authorSubscribers.get(author);
      const isNewLifetime = !roster.has(subscriber);
      roster.add(subscriber);
      profile.stats.activeSubscribers += 1;
      if (isNewLifetime) profile.stats.lifetimeSubscribers += 1;
    }
    this.emit('subscription:created', sub);
    return sub;
  }

  getSubscription(author, subscriber) {
    return this.subscriptions.get(subKey(author, subscriber)) || null;
  }

  hasActiveSubscription(author, subscriber) {
    const sub = this.getSubscription(author, subscriber);
    return Boolean(sub && sub.expiresAt > nowSec());
  }

  // ── Analytics & feeds ────────────────────────────────────────────────────

  getStats(author) {
    const profile = this.requireAuthor(author);
    // recompute active subscriber count to drop expired entries
    const now = nowSec();
    let active = 0;
    for (const sub of this.subscriptions.values()) {
      if (sub.author === author && sub.expiresAt > now) active += 1;
    }
    profile.stats.activeSubscribers = active;
    return { ...profile.stats };
  }

  getArticlesByAuthor(author, { limit = 20, offset = 0 } = {}) {
    this.requireAuthor(author);
    const ids = Array.from(this.authorArticles.get(author) || []).reverse();
    const slice = ids.slice(Number(offset), Number(offset) + Number(limit));
    return slice.map((id) => this.articles.get(id)).filter(Boolean);
  }

  getSubscribers(author, { limit = 100, offset = 0 } = {}) {
    this.requireAuthor(author);
    const now = nowSec();
    const rows = Array.from(this.authorSubscribers.get(author) || [])
      .map((subscriber) => this.subscriptions.get(subKey(author, subscriber)))
      .filter(Boolean)
      .map((sub) => ({ ...sub, active: sub.expiresAt > now }));
    return rows.slice(Number(offset), Number(offset) + Number(limit));
  }

  getLatestArticles({ limit = 20 } = {}) {
    return this.latestIds
      .slice(0, Number(limit))
      .map((id) => this.articles.get(id))
      .filter(Boolean);
  }

  /// Aggregated platform-wide metrics for the analytics dashboard.
  getPlatformAnalytics() {
    let totalTips = 0;
    let totalViews = 0;
    let totalLikes = 0;
    let activeSubs = 0;
    const now = nowSec();
    for (const article of this.articles.values()) {
      totalTips += article.tipsCollected;
      totalViews += article.views;
      totalLikes += article.likes;
    }
    for (const sub of this.subscriptions.values()) {
      if (sub.expiresAt > now) activeSubs += 1;
    }
    return {
      authors: this.authors.size,
      articles: this.articles.size,
      activeSubscriptions: activeSubs,
      totalTips,
      totalViews,
      totalLikes,
      timestamp: new Date().toISOString(),
    };
  }

  // Test/ops helper — never expose this over HTTP.
  reset() {
    this.authors.clear();
    this.articles.clear();
    this.subscriptions.clear();
    this.likes.clear();
    this.authorArticles.clear();
    this.authorSubscribers.clear();
    this.latestIds = [];
    this.nextId = 1;
  }

  requireAuthor(address) {
    const profile = this.authors.get(address);
    if (!profile) throw httpError(404, 'Author not found');
    return profile;
  }
}

function subKey(author, subscriber) {
  return `${author}|${subscriber}`;
}

function emptyStats() {
  return {
    articleCount: 0,
    totalViews: 0,
    totalLikes: 0,
    totalTips: 0,
    activeSubscribers: 0,
    lifetimeSubscribers: 0,
    subscriptionRevenue: 0,
  };
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const contentPublishingService = new ContentPublishingService();
export default contentPublishingService;
export { ContentPublishingService };
