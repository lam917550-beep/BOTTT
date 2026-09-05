import { LruCache } from "../cache/lru.js";

export class SlidingLimiter {
  private hits = new LruCache<string, number[]>(20_000, 60_000);

  constructor(
    private windowMs: number,
    private max: number,
  ) {}

  take(key: string): { ok: boolean; retryAfterSec: number } {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      const oldest = arr[0] ?? now;
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((this.windowMs - (now - oldest)) / 1000)) };
    }
    arr.push(now);
    this.hits.set(key, arr, this.windowMs);
    return { ok: true, retryAfterSec: 0 };
  }
}

export const commandLimiter = new SlidingLimiter(10_000, 12);
export const aiLimiter = new SlidingLimiter(60_000, 8);
export const imgLimiter = new SlidingLimiter(60_000, 3);
export const authLimiter = new SlidingLimiter(15 * 60_000, 10);
export const gameLimiter = new SlidingLimiter(10_000, 8);
export const apiLimiter = new SlidingLimiter(10_000, 40);
