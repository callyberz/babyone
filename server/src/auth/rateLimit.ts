interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOpts {
  maxAttempts: number;
  windowMs: number;
  maxBuckets?: number;
  caseInsensitive?: boolean;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Small in-process fixed-window limiter for the single-machine deployment.
 * Expired buckets are pruned and live storage is capped, so arbitrary keys
 * cannot grow the process indefinitely.
 */
export class LoginRateLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly maxBuckets: number;

  constructor(private readonly opts: RateLimitOpts) {
    this.maxBuckets = Math.max(1, opts.maxBuckets ?? 5_000);
  }

  check(keyRaw: string): boolean {
    return this.checkDetailed(keyRaw).allowed;
  }

  checkDetailed(keyRaw: string, now = Date.now()): RateLimitDecision {
    const key = this.normalizeKey(keyRaw);
    let bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt <= now) {
      this.buckets.delete(key);
      bucket = undefined;
    }

    if (!bucket) {
      this.makeRoom(now);
      this.buckets.set(key, {
        count: 1,
        resetAt: now + this.opts.windowMs,
      });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000),
    );
    if (bucket.count >= this.opts.maxAttempts) {
      return { allowed: false, retryAfterSeconds };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  reset(keyRaw: string): void {
    this.buckets.delete(this.normalizeKey(keyRaw));
  }

  clear(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }

  private makeRoom(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    while (this.buckets.size >= this.maxBuckets) {
      const oldest = this.buckets.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }

  private normalizeKey(key: string): string {
    return this.opts.caseInsensitive === false ? key : key.toLowerCase();
  }
}
