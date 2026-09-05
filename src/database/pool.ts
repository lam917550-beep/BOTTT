import pg from "pg";
import type { AppConfig } from "../config/env.js";
import type { Logger } from "../logging/logger.js";

export function createPool(cfg: AppConfig): pg.Pool {
  return new pg.Pool({
    connectionString: cfg.DATABASE_URL,
    max: cfg.isProduction ? 20 : 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  });
}

export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function pingDb(pool: pg.Pool, log: Logger): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (err) {
    log.error("db.ping_failed", { error: String(err) });
    return false;
  }
}
