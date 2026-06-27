import { LRUCache } from 'lru-cache';
import redisService from './redisService.js';

const BLACKLIST_PREFIX = 'ddos:blacklist:';
const WHITELIST_PREFIX = 'ddos:whitelist:';
const SCORE_PREFIX = 'ddos:score:';

const DEFAULT_BLACKLIST_TTL_SECONDS = Number.parseInt(
  process.env.DDOS_BLACKLIST_TTL_SECONDS || '3600',
  10
);
const DEFAULT_SPIKE_THRESHOLD = Number.parseInt(
  process.env.DDOS_SPIKE_THRESHOLD || '200',
  10
);
const DEFAULT_SPIKE_WINDOW_MS = Number.parseInt(
  process.env.DDOS_SPIKE_WINDOW_MS || '10000',
  10
);

const memoryBlacklist = new LRUCache({
  max: 10_000,
  ttl: DEFAULT_BLACKLIST_TTL_SECONDS * 1000,
});
const memoryWhitelist = new Set(
  (process.env.DDOS_WHITELIST_IPS || '127.0.0.1,::1')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean)
);
const memoryScores = new LRUCache({
  max: 20_000,
  ttl: DEFAULT_SPIKE_WINDOW_MS,
});

function blacklistKey(ip) {
  return `${BLACKLIST_PREFIX}${ip}`;
}

function whitelistKey(ip) {
  return `${WHITELIST_PREFIX}${ip}`;
}

function scoreKey(ip) {
  return `${SCORE_PREFIX}${ip}`;
}

class IpFilterService {
  constructor() {
    this.spikeThreshold = DEFAULT_SPIKE_THRESHOLD;
    this.spikeWindowMs = DEFAULT_SPIKE_WINDOW_MS;
    this.blacklistTtlSeconds = DEFAULT_BLACKLIST_TTL_SECONDS;
  }

  async isWhitelisted(ip) {
    if (memoryWhitelist.has(ip)) return true;
    if (redisService.isFallbackMode || !redisService.client) return false;
    try {
      const value = await redisService.client.get(whitelistKey(ip));
      return value === '1';
    } catch {
      return false;
    }
  }

  async addWhitelist(ip, ttlSeconds = null) {
    memoryWhitelist.add(ip);
    if (redisService.isFallbackMode || !redisService.client) return true;
    if (ttlSeconds) {
      await redisService.client.set(whitelistKey(ip), '1', 'EX', ttlSeconds);
    } else {
      await redisService.client.set(whitelistKey(ip), '1');
    }
    return true;
  }

  async isBlacklisted(ip) {
    if (memoryBlacklist.has(ip)) return true;
    if (redisService.isFallbackMode || !redisService.client) return false;
    try {
      const value = await redisService.client.get(blacklistKey(ip));
      return value === '1';
    } catch {
      return memoryBlacklist.has(ip);
    }
  }

  async blacklistIp(
    ip,
    reason = 'automated',
    ttlSeconds = this.blacklistTtlSeconds
  ) {
    memoryBlacklist.set(ip, { reason, blockedAt: Date.now() });
    if (redisService.isFallbackMode || !redisService.client) return true;
    try {
      await redisService.client.set(
        blacklistKey(ip),
        JSON.stringify({ reason, blockedAt: new Date().toISOString() }),
        'EX',
        ttlSeconds
      );
    } catch {
      // memory fallback already recorded
    }
    return true;
  }

  async recordRequestAndScore(ip) {
    const now = Date.now();
    const windowStart = now - this.spikeWindowMs;

    if (redisService.isFallbackMode || !redisService.client) {
      const bucket = memoryScores.get(ip) || [];
      const fresh = bucket.filter((ts) => ts > windowStart);
      fresh.push(now);
      memoryScores.set(ip, fresh);
      return {
        count: fresh.length,
        threshold: this.spikeThreshold,
        windowMs: this.spikeWindowMs,
        shouldBlock: fresh.length > this.spikeThreshold,
      };
    }

    const key = scoreKey(ip);
    const member = `${now}`;
    try {
      const pipeline = redisService.client.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, now, member);
      pipeline.zcard(key);
      pipeline.pexpire(key, this.spikeWindowMs);
      const results = await pipeline.exec();
      const count = results?.[2]?.[1] ?? 0;
      return {
        count,
        threshold: this.spikeThreshold,
        windowMs: this.spikeWindowMs,
        shouldBlock: count > this.spikeThreshold,
      };
    } catch {
      const bucket = memoryScores.get(ip) || [];
      const fresh = bucket.filter((ts) => ts > windowStart);
      fresh.push(now);
      memoryScores.set(ip, fresh);
      return {
        count: fresh.length,
        threshold: this.spikeThreshold,
        windowMs: this.spikeWindowMs,
        shouldBlock: fresh.length > this.spikeThreshold,
      };
    }
  }

  clearMemoryState() {
    memoryBlacklist.clear();
    memoryScores.clear();
  }
}

export const ipFilterService = new IpFilterService();
export default ipFilterService;
