import type { Pool } from "pg";
import { LruCache } from "../cache/lru.js";

const cache = new LruCache<string, boolean>(64, 5_000);

export class FeatureFlags {
  constructor(private pool: Pool) {}

  async get(key: string): Promise<boolean> {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const res = await this.pool.query<{ enabled: boolean }>("SELECT enabled FROM feature_flags WHERE key = $1", [key]);
    const enabled = res.rows[0]?.enabled ?? false;
    cache.set(key, enabled);
    return enabled;
  }

  async set(key: string, enabled: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO feature_flags (key, enabled, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
      [key, enabled],
    );
    cache.set(key, enabled);
  }

  async all(): Promise<Record<string, boolean>> {
    const res = await this.pool.query<{ key: string; enabled: boolean }>("SELECT key, enabled FROM feature_flags");
    const out: Record<string, boolean> = {};
    for (const row of res.rows) {
      out[row.key] = row.enabled;
      cache.set(row.key, row.enabled);
    }
    return out;
  }
}
