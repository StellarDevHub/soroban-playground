// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const profiles  = new Map(); // address -> Profile
const posts     = new Map(); // postId (number) -> Post
const following = new Set(); // `${follower}:${creator}`
const subscribed = new Set(); // `${subscriber}:${creator}`
const earnings  = new Map(); // address -> i128 (number)
let postCounter = 0;

// Global analytics counters
const globalStats = {
  totalProfiles: 0,
  totalPosts: 0,
  totalLikes: 0,
  totalTips: 0,
  totalSubscriptions: 0,
  totalSubscriptionRevenue: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateAddress(addr) {
  return typeof addr === 'string' && addr.length > 0;
}

function buildCreatorAnalytics(address) {
  const profile = profiles.get(address) || {};
  const creatorPosts = Array.from(posts.values()).filter(p => p.author === address);

  const totalTips = creatorPosts.reduce((s, p) => s + p.tipsCollected, 0);
  const totalLikes = creatorPosts.reduce((s, p) => s + p.likes, 0);

  // Count subscribers
  let subscriberCount = 0;
  for (const key of subscribed) {
    if (key.endsWith(`:${address}`)) subscriberCount++;
  }

  // Count followers
  let followerCount = profile.followers || 0;

  return {
    address,
    postCount: creatorPosts.length,
    totalTips,
    totalLikes,
    subscriberCount,
    followerCount,
    withdrawableEarnings: earnings.get(address) || 0,
  };
}

// ---------------------------------------------------------------------------
// POST /profiles
// ---------------------------------------------------------------------------

router.post(
  '/profiles',
  asyncHandler(async (req, res) => {
    const { address, nickname, bio } = req.body || {};
    if (!validateAddress(address)) throw createHttpError(400, 'address is required');
    if (!nickname) throw createHttpError(400, 'nickname is required');

    const existing = profiles.get(address);
    const profile = {
      address,
      nickname: String(nickname).slice(0, 80),
      bio: String(bio || '').slice(0, 280),
      followers: existing?.followers ?? 0,
      following: existing?.following ?? 0,
      postCount: existing?.postCount ?? 0,
      createdAt: existing?.createdAt ?? Math.floor(Date.now() / 1000),
    };

    if (!existing) globalStats.totalProfiles++;
    profiles.set(address, profile);

    res.status(existing ? 200 : 201).json({ success: true, data: profile });
  })
);

// ---------------------------------------------------------------------------
// GET /profiles/:address
// ---------------------------------------------------------------------------

router.get(
  '/profiles/:address',
  asyncHandler(async (req, res) => {
    const profile = profiles.get(req.params.address);
    if (!profile) throw createHttpError(404, 'Profile not found');
    res.json({ success: true, data: profile });
  })
);

// ---------------------------------------------------------------------------
// GET /leaderboard
// ---------------------------------------------------------------------------

router.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const { by = 'earnings', limit = '10' } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 10, 50);

    const creators = Array.from(profiles.keys()).map(addr => buildCreatorAnalytics(addr));

    const sortFns = {
      earnings:    (a, b) => b.withdrawableEarnings - a.withdrawableEarnings,
      followers:   (a, b) => b.followerCount - a.followerCount,
      subscribers: (a, b) => b.subscriberCount - a.subscriberCount,
      posts:       (a, b) => b.postCount - a.postCount,
      likes:       (a, b) => b.totalLikes - a.totalLikes,
    };

    creators.sort(sortFns[by] ?? sortFns.earnings);
    res.json({ success: true, data: creators.slice(0, lim) });
  })
);

// ---------------------------------------------------------------------------
// Social graph
// ---------------------------------------------------------------------------

router.post(
  '/follow',
  asyncHandler(async (req, res) => {
    const { follower, creator } = req.body || {};
    if (!validateAddress(follower) || !validateAddress(creator))
      throw createHttpError(400, 'follower and creator are required');
    if (follower === creator) throw createHttpError(400, 'Cannot follow yourself');

    const key = `${follower}:${creator}`;
    if (!following.has(key)) {
      following.add(key);
      const creatorProfile = profiles.get(creator);
      if (creatorProfile) { creatorProfile.followers++; }
      const followerProfile = profiles.get(follower);
      if (followerProfile) { followerProfile.following++; }
    }
    res.json({ success: true, data: { follower, creator, following: true } });
  })
);

router.post(
  '/unfollow',
  asyncHandler(async (req, res) => {
    const { follower, creator } = req.body || {};
    if (!validateAddress(follower) || !validateAddress(creator))
      throw createHttpError(400, 'follower and creator are required');

    const key = `${follower}:${creator}`;
    if (following.has(key)) {
      following.delete(key);
      const creatorProfile = profiles.get(creator);
      if (creatorProfile) creatorProfile.followers = Math.max(0, creatorProfile.followers - 1);
      const followerProfile = profiles.get(follower);
      if (followerProfile) followerProfile.following = Math.max(0, followerProfile.following - 1);
    }
    res.json({ success: true, data: { follower, creator, following: false } });
  })
);

router.get(
  '/following',
  asyncHandler(async (req, res) => {
    const { follower, creator } = req.query;
    if (!follower || !creator) throw createHttpError(400, 'follower and creator query params required');
    res.json({ success: true, data: { isFollowing: following.has(`${follower}:${creator}`) } });
  })
);

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

router.post(
  '/subscribe',
  asyncHandler(async (req, res) => {
    const { subscriber, creator, amount } = req.body || {};
    if (!validateAddress(subscriber) || !validateAddress(creator))
      throw createHttpError(400, 'subscriber and creator are required');
    const amt = Number(amount);
    if (!amt || amt <= 0) throw createHttpError(400, 'amount must be positive');

    const key = `${subscriber}:${creator}`;
    const isNew = !subscribed.has(key);
    subscribed.add(key);

    const prev = earnings.get(creator) || 0;
    earnings.set(creator, prev + amt);

    if (isNew) globalStats.totalSubscriptions++;
    globalStats.totalSubscriptionRevenue += amt;

    res.json({ success: true, data: { subscriber, creator, amount: amt, isNew } });
  })
);

router.post(
  '/unsubscribe',
  asyncHandler(async (req, res) => {
    const { subscriber, creator } = req.body || {};
    if (!validateAddress(subscriber) || !validateAddress(creator))
      throw createHttpError(400, 'subscriber and creator are required');

    subscribed.delete(`${subscriber}:${creator}`);
    res.json({ success: true, data: { subscriber, creator, subscribed: false } });
  })
);

router.get(
  '/subscribed',
  asyncHandler(async (req, res) => {
    const { subscriber, creator } = req.query;
    if (!subscriber || !creator) throw createHttpError(400, 'subscriber and creator query params required');
    res.json({ success: true, data: { isSubscribed: subscribed.has(`${subscriber}:${creator}`) } });
  })
);

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

router.post(
  '/posts',
  asyncHandler(async (req, res) => {
    const { author, contentHash, isPremium = false, minTip = 0 } = req.body || {};
    if (!validateAddress(author)) throw createHttpError(400, 'author is required');
    if (!contentHash) throw createHttpError(400, 'contentHash is required');
    if (!profiles.has(author)) throw createHttpError(400, 'Profile not found. Create a profile first.');

    postCounter++;
    const post = {
      id: postCounter,
      author,
      contentHash: String(contentHash),
      timestamp: Math.floor(Date.now() / 1000),
      likes: 0,
      tipsCollected: 0,
      isPremium: Boolean(isPremium),
      minTip: Number(minTip) || 0,
    };
    posts.set(post.id, post);

    const profile = profiles.get(author);
    if (profile) profile.postCount++;

    globalStats.totalPosts++;

    res.status(201).json({ success: true, data: post });
  })
);

router.get(
  '/posts',
  asyncHandler(async (req, res) => {
    const { author, premium, limit = '20', offset = '0' } = req.query;
    let list = Array.from(posts.values()).sort((a, b) => b.id - a.id);

    if (author) list = list.filter(p => p.author === author);
    if (premium !== undefined) list = list.filter(p => p.isPremium === (premium === 'true'));

    const lim = parseInt(limit, 10);
    const off = parseInt(offset, 10);
    const total = list.length;
    const page = list.slice(off, off + lim).map(p => ({
      ...p,
      authorProfile: profiles.get(p.author) || null,
    }));

    res.json({ success: true, data: page, meta: { total, limit: lim, offset: off } });
  })
);

router.get(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const post = posts.get(id);
    if (!post) throw createHttpError(404, `Post ${id} not found`);
    res.json({ success: true, data: { ...post, authorProfile: profiles.get(post.author) || null } });
  })
);

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------

router.post(
  '/posts/:id/like',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const post = posts.get(id);
    if (!post) throw createHttpError(404, `Post ${id} not found`);
    const { caller } = req.body || {};
    if (!validateAddress(caller)) throw createHttpError(400, 'caller is required');

    post.likes++;
    globalStats.totalLikes++;

    res.json({ success: true, data: { postId: id, likes: post.likes } });
  })
);

router.post(
  '/posts/:id/tip',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const post = posts.get(id);
    if (!post) throw createHttpError(404, `Post ${id} not found`);

    const { caller, amount } = req.body || {};
    if (!validateAddress(caller)) throw createHttpError(400, 'caller is required');
    const amt = Number(amount);
    if (!amt || amt <= 0) throw createHttpError(400, 'amount must be positive');
    if (amt < post.minTip) throw createHttpError(400, `Tip must be at least ${post.minTip} stroops`);

    if (post.isPremium && !subscribed.has(`${caller}:${post.author}`)) {
      throw createHttpError(403, 'Must be subscribed to tip premium content');
    }

    post.tipsCollected += amt;
    const prev = earnings.get(post.author) || 0;
    earnings.set(post.author, prev + amt);
    globalStats.totalTips += amt;

    res.json({ success: true, data: { postId: id, tipsCollected: post.tipsCollected } });
  })
);

// ---------------------------------------------------------------------------
// Creator analytics & earnings
// ---------------------------------------------------------------------------

router.get(
  '/analytics/:address',
  asyncHandler(async (req, res) => {
    if (!profiles.has(req.params.address)) throw createHttpError(404, 'Profile not found');
    res.json({ success: true, data: buildCreatorAnalytics(req.params.address) });
  })
);

router.post(
  '/withdraw',
  asyncHandler(async (req, res) => {
    const { creator } = req.body || {};
    if (!validateAddress(creator)) throw createHttpError(400, 'creator is required');
    const amount = earnings.get(creator) || 0;
    if (amount === 0) throw createHttpError(400, 'No earnings to withdraw');
    earnings.set(creator, 0);
    res.json({ success: true, data: { creator, withdrawn: amount } });
  })
);

// ---------------------------------------------------------------------------
// Global stats
// ---------------------------------------------------------------------------

router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: { ...globalStats, totalProfiles: profiles.size, totalPosts: posts.size } });
  })
);

export default router;
