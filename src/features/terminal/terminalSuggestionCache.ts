// @author kongweiguang

import type {
  CommandSuggestionCandidate,
  CommandSuggestionQueryMode,
} from "../../lib/terminalSuggestionApi";
import type { TerminalSuggestionCacheStats } from "./terminalSuggestionModel";

export interface CachedTerminalSuggestion {
  cachedAt: number;
  candidate: CommandSuggestionCandidate;
  stale: boolean;
}

export interface TerminalSuggestionCacheConfig {
  maxBucketsPerPane: number;
  maxCandidates: number;
  maxCandidatesPerBucket: number;
  staleTtlMs: number;
  ttlMs: number;
}

interface CacheBucket {
  candidates: readonly CommandSuggestionCandidate[];
  contextKey: string;
  cursor: number;
  input: string;
  key: string;
  lastAccessedAt: number;
  mode: CommandSuggestionQueryMode;
  paneId: string;
  storedAt: number;
}

const DEFAULT_CONFIG: TerminalSuggestionCacheConfig = {
  maxBucketsPerPane: 8,
  maxCandidates: 4096,
  maxCandidatesPerBucket: 64,
  staleTtlMs: 120_000,
  ttlMs: 30_000,
};

/**
 * 所有 pane 共用一个有界存储，既保证 pane 内 8 bucket，也提供全局候选硬上限。
 */
export class TerminalSuggestionCache {
  private readonly buckets = new Map<string, CacheBucket>();
  private readonly config: TerminalSuggestionCacheConfig;
  private evictions = 0;
  private expiredBuckets = 0;
  private hits = 0;
  private misses = 0;
  private staleHits = 0;

  constructor(config: Partial<TerminalSuggestionCacheConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      maxBucketsPerPane: positiveInteger(
        config.maxBucketsPerPane,
        DEFAULT_CONFIG.maxBucketsPerPane,
      ),
      maxCandidates: positiveInteger(
        config.maxCandidates,
        DEFAULT_CONFIG.maxCandidates,
      ),
      maxCandidatesPerBucket: positiveInteger(
        config.maxCandidatesPerBucket,
        DEFAULT_CONFIG.maxCandidatesPerBucket,
      ),
      staleTtlMs: positiveInteger(
        config.staleTtlMs,
        DEFAULT_CONFIG.staleTtlMs,
      ),
      ttlMs: positiveInteger(config.ttlMs, DEFAULT_CONFIG.ttlMs),
    };
  }

  put({
    candidates,
    contextKey,
    cursor,
    input,
    mode,
    now,
    paneId,
  }: {
    candidates: readonly CommandSuggestionCandidate[];
    contextKey: string;
    cursor: number;
    input: string;
    mode: CommandSuggestionQueryMode;
    now: number;
    paneId: string;
  }) {
    const key = bucketKey(paneId, contextKey, mode, input, cursor);
    this.buckets.delete(key);
    this.buckets.set(key, {
      candidates: candidates.slice(0, this.config.maxCandidatesPerBucket),
      contextKey,
      cursor,
      input,
      key,
      lastAccessedAt: now,
      mode,
      paneId,
      storedAt: now,
    });
    this.evictPaneOverflow(paneId);
    this.evictGlobalOverflow();
  }

  get({
    contextKey,
    mode,
    now,
    paneId,
  }: {
    contextKey: string;
    mode: CommandSuggestionQueryMode;
    now: number;
    paneId: string;
  }): CachedTerminalSuggestion[] {
    const matching: CacheBucket[] = [];
    for (const bucket of this.buckets.values()) {
      if (
        bucket.paneId !== paneId ||
        bucket.contextKey !== contextKey ||
        bucket.mode !== mode
      ) {
        continue;
      }
      const age = now - bucket.storedAt;
      if (age > this.config.staleTtlMs) {
        this.deleteBucket(bucket.key, true);
        continue;
      }
      bucket.lastAccessedAt = now;
      matching.push(bucket);
    }

    if (matching.length === 0) {
      this.misses += 1;
      return [];
    }

    this.hits += 1;
    matching.sort(
      (left, right) =>
        right.storedAt - left.storedAt || left.key.localeCompare(right.key),
    );
    const results: CachedTerminalSuggestion[] = [];
    for (const bucket of matching) {
      const stale = now - bucket.storedAt > this.config.ttlMs;
      if (stale) {
        this.staleHits += 1;
      }
      for (const candidate of bucket.candidates) {
        results.push({ cachedAt: bucket.storedAt, candidate, stale });
      }
    }
    return results;
  }

  clearPane(paneId: string) {
    for (const bucket of Array.from(this.buckets.values())) {
      if (bucket.paneId === paneId) {
        this.buckets.delete(bucket.key);
      }
    }
  }

  clear() {
    this.buckets.clear();
  }

  stats(): TerminalSuggestionCacheStats {
    const panes = new Set<string>();
    let candidateCount = 0;
    for (const bucket of this.buckets.values()) {
      panes.add(bucket.paneId);
      candidateCount += bucket.candidates.length;
    }
    return {
      bucketCount: this.buckets.size,
      candidateCount,
      evictions: this.evictions,
      expiredBuckets: this.expiredBuckets,
      hits: this.hits,
      misses: this.misses,
      paneCount: panes.size,
      staleHits: this.staleHits,
    };
  }

  private evictPaneOverflow(paneId: string) {
    const paneBuckets = Array.from(this.buckets.values())
      .filter((bucket) => bucket.paneId === paneId)
      .sort(compareLeastRecentlyUsed);
    while (paneBuckets.length > this.config.maxBucketsPerPane) {
      const bucket = paneBuckets.shift();
      if (bucket) {
        this.deleteBucket(bucket.key);
      }
    }
  }

  private evictGlobalOverflow() {
    const buckets = Array.from(this.buckets.values()).sort(
      compareLeastRecentlyUsed,
    );
    let candidateCount = buckets.reduce(
      (total, bucket) => total + bucket.candidates.length,
      0,
    );
    while (candidateCount > this.config.maxCandidates) {
      const bucket = buckets.shift();
      if (!bucket) {
        break;
      }
      candidateCount -= bucket.candidates.length;
      this.deleteBucket(bucket.key);
    }
  }

  private deleteBucket(key: string, expired = false) {
    if (!this.buckets.delete(key)) {
      return;
    }
    if (expired) {
      this.expiredBuckets += 1;
    } else {
      this.evictions += 1;
    }
  }
}

export const terminalSuggestionCache = new TerminalSuggestionCache();

function bucketKey(
  paneId: string,
  contextKey: string,
  mode: CommandSuggestionQueryMode,
  input: string,
  cursor: number,
) {
  return [paneId, contextKey, mode, cursor, input].join("\u0000");
}

function compareLeastRecentlyUsed(left: CacheBucket, right: CacheBucket) {
  return (
    left.lastAccessedAt - right.lastAccessedAt ||
    left.storedAt - right.storedAt ||
    left.key.localeCompare(right.key)
  );
}

function positiveInteger(value: number | undefined, fallback: number) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? (value as number)
    : fallback;
}
