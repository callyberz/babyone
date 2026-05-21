interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOpts {
  maxAttempts: number;
  windowMs: number;
}

export class LoginRateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private opts: RateLimitOpts) {}

  // Returns true if the attempt is allowed; false if currently blocked.
  // Increments the counter on every call (success or failure — callers may
  // optionally reset() on successful login to be lenient).
  check(emailRaw: string): boolean {
    const email = emailRaw.toLowerCase();
    const now = Date.now();
    const b = this.buckets.get(email);
    if (!b || b.resetAt <= now) {
      this.buckets.set(email, {
        count: 1,
        resetAt: now + this.opts.windowMs,
      });
      return true;
    }
    if (b.count >= this.opts.maxAttempts) return false;
    b.count++;
    return true;
  }

  reset(emailRaw: string): void {
    this.buckets.delete(emailRaw.toLowerCase());
  }
}
