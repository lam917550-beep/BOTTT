import bcrypt from "bcrypt";
import type { Pool } from "pg";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config/env.js";
import { languageCache } from "../i18n/language-cache.js";
import { DEFAULT_LOCALE, parseLocale, type Locale } from "../i18n/locales.js";
import { starterPetId } from "../pets/catalog.js";
import { EconomyService } from "../economy/service.js";
import { rankForXp } from "../quests/catalog.js";

export interface UserRecord {
  id: string;
  telegram_id: string | null;
  username: string | null;
  email: string | null;
  locale: string;
  level: number;
  xp: string;
  rank_tier: string;
  streak_days: number;
  last_login_date: string | null;
  last_daily_claim: string | null;
}

export class UserService {
  constructor(
    private pool: Pool,
    private cfg: AppConfig,
    private economy: EconomyService,
  ) {}

  async ensureTelegramUser(telegramId: bigint, username: string | undefined): Promise<{ user: UserRecord; created: boolean }> {
    const existing = await this.pool.query<UserRecord>(
      "SELECT id, telegram_id::text, username, email, locale, level, xp::text, rank_tier, streak_days, last_login_date::text, last_daily_claim::text FROM users WHERE telegram_id = $1",
      [telegramId.toString()],
    );
    const found = existing.rows[0];
    if (found) {
      languageCache.resolve(found.id, found.locale);
      await this.touchLogin(found.id);
      return { user: found, created: false };
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<UserRecord>(
        `INSERT INTO users (telegram_id, username, locale)
         VALUES ($1,$2,$3)
         RETURNING id, telegram_id::text, username, email, locale, level, xp::text, rank_tier, streak_days, last_login_date::text, last_daily_claim::text`,
        [telegramId.toString(), username ?? null, DEFAULT_LOCALE],
      );
      const user = inserted.rows[0];
      if (!user) throw new Error("USER_INSERT_FAILED");
      await client.query("INSERT INTO wallets (user_id, balance) VALUES ($1,$2)", [
        user.id,
        this.cfg.STARTING_BALANCE,
      ]);
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after)
         VALUES ($1,'starting',$2,0,$2)`,
        [user.id, this.cfg.STARTING_BALANCE],
      );
      await client.query(
        `INSERT INTO owned_pets (user_id, pet_def_id) VALUES ($1,$2)`,
        [user.id, starterPetId()],
      );
      await client.query(
        `INSERT INTO achievements (user_id, achievement_id) VALUES ($1,'a_first_pet') ON CONFLICT DO NOTHING`,
        [user.id],
      );
      await client.query("COMMIT");
      languageCache.set(user.id, DEFAULT_LOCALE);
      return { user, created: true };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getById(id: string): Promise<UserRecord | undefined> {
    const res = await this.pool.query<UserRecord>(
      "SELECT id, telegram_id::text, username, email, locale, level, xp::text, rank_tier, streak_days, last_login_date::text, last_daily_claim::text FROM users WHERE id = $1",
      [id],
    );
    return res.rows[0];
  }

  async setLocale(userId: string, locale: Locale): Promise<void> {
    await this.pool.query("UPDATE users SET locale = $2, updated_at = now() WHERE id = $1", [userId, locale]);
    languageCache.set(userId, locale);
  }

  localeOf(user: UserRecord): Locale {
    return languageCache.resolve(user.id, user.locale);
  }

  async register(email: string, password: string, username: string): Promise<UserRecord> {
    const hash = await bcrypt.hash(password, this.cfg.BCRYPT_ROUNDS);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<UserRecord>(
        `INSERT INTO users (email, password_hash, username, locale)
         VALUES ($1,$2,$3,$4)
         RETURNING id, telegram_id::text, username, email, locale, level, xp::text, rank_tier, streak_days, last_login_date::text, last_daily_claim::text`,
        [email.toLowerCase(), hash, username, DEFAULT_LOCALE],
      );
      const user = inserted.rows[0];
      if (!user) throw new Error("USER_INSERT_FAILED");
      await client.query("INSERT INTO wallets (user_id, balance) VALUES ($1,$2)", [user.id, this.cfg.STARTING_BALANCE]);
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after) VALUES ($1,'starting',$2,0,$2)`,
        [user.id, this.cfg.STARTING_BALANCE],
      );
      await client.query(`INSERT INTO owned_pets (user_id, pet_def_id) VALUES ($1,$2)`, [user.id, starterPetId()]);
      await client.query("COMMIT");
      return user;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async login(email: string, password: string): Promise<UserRecord> {
    const res = await this.pool.query<UserRecord & { password_hash: string | null }>(
      "SELECT id, telegram_id::text, username, email, locale, level, xp::text, rank_tier, streak_days, last_login_date::text, last_daily_claim::text, password_hash FROM users WHERE email = $1",
      [email.toLowerCase()],
    );
    const user = res.rows[0];
    if (!user?.password_hash) throw new Error("INVALID_CREDENTIALS");
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new Error("INVALID_CREDENTIALS");
    await this.touchLogin(user.id);
    return user;
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const res = await this.pool.query<{ password_hash: string | null }>(
      "SELECT password_hash FROM users WHERE id = $1",
      [userId],
    );
    const hash = res.rows[0]?.password_hash;
    if (!hash) throw new Error("NO_PASSWORD");
    const ok = await bcrypt.compare(current, hash);
    if (!ok) throw new Error("INVALID_CREDENTIALS");
    const nextHash = await bcrypt.hash(next, this.cfg.BCRYPT_ROUNDS);
    await this.pool.query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [userId, nextHash]);
  }

  async createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.pool.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2,$3)", [
      userId,
      tokenHash,
      expiresAt,
    ]);
    return { token, expiresAt };
  }

  async sessionUser(token: string): Promise<UserRecord | undefined> {
    const tokenHash = sha256(token);
    const res = await this.pool.query<UserRecord>(
      `SELECT u.id, u.telegram_id::text, u.username, u.email, u.locale, u.level, u.xp::text, u.rank_tier, u.streak_days, u.last_login_date::text, u.last_daily_claim::text
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [tokenHash],
    );
    return res.rows[0];
  }

  async revokeSession(token: string): Promise<void> {
    await this.pool.query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [
      sha256(token),
    ]);
  }

  async revokeAll(userId: string): Promise<void> {
    await this.pool.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
  }

  async linkTelegram(userId: string, telegramId: bigint): Promise<void> {
    await this.pool.query("UPDATE users SET telegram_id = $2, updated_at = now() WHERE id = $1 AND telegram_id IS NULL", [
      userId,
      telegramId.toString(),
    ]);
  }

  async claimDaily(userId: string): Promise<{ amount: bigint; streak: number; already: boolean }> {
    const today = new Date().toISOString().slice(0, 10);
    const user = await this.getById(userId);
    if (!user) throw new Error("USER_MISSING");
    if (user.last_daily_claim === today) {
      return { amount: 0n, streak: user.streak_days, already: true };
    }
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const streak = user.last_login_date === yesterday || user.last_daily_claim === yesterday ? user.streak_days + 1 : 1;
    const amount = BigInt(200 + Math.min(20, streak) * 50);
    await this.economy.addCoins({
      userId,
      amount,
      type: "daily",
      idempotencyKey: `daily:${userId}:${today}`,
    });
    await this.pool.query(
      "UPDATE users SET last_daily_claim = $2::date, streak_days = $3, updated_at = now() WHERE id = $1",
      [userId, today, streak],
    );
    return { amount, streak, already: false };
  }

  async addXp(userId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    const res = await this.pool.query<{ xp: string }>(
      "UPDATE users SET xp = xp + $2, updated_at = now() WHERE id = $1 RETURNING xp::text",
      [userId, amount],
    );
    const xp = Number(res.rows[0]?.xp ?? 0);
    const rank = rankForXp(xp);
    const level = 1 + Math.floor(xp / 500);
    await this.pool.query("UPDATE users SET rank_tier = $2, level = $3 WHERE id = $1", [userId, rank, level]);
  }

  private async touchLogin(userId: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    await this.pool.query("UPDATE users SET last_login_date = $2::date, updated_at = now() WHERE id = $1", [
      userId,
      today,
    ]);
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export { parseLocale };
