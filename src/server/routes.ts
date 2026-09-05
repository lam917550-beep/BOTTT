import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { verifyTelegramInitData } from "../auth/telegram.js";
import type { AppConfig } from "../config/env.js";
import type { UserService, UserRecord } from "../users/service.js";
import type { EconomyService } from "../economy/service.js";
import { getGame, getGameCatalog, gameOfTheDay, searchGames, type GameCategory } from "../games/catalog.js";
import { getPetCatalog, petOfTheDay } from "../pets/catalog.js";
import type { GamePlayService } from "../games/play.js";
import type { PetService, PetAction } from "../pets/service.js";
import { getQuestCatalog, getAchievementCatalog, masteryLabel } from "../quests/catalog.js";
import { FeatureFlags } from "../owner/flags.js";
import { authLimiter, gameLimiter, apiLimiter } from "../security/ratelimit.js";
import { GAME_CATEGORIES } from "../games/catalog.js";
import type { Pool } from "pg";

const emailSchema = z.string().email().max(120);
const passwordSchema = z.string().min(10).max(100);
const usernameSchema = z.string().min(2).max(24).regex(/^[a-zA-Z0-9_]+$/);

export interface ApiDeps {
  cfg: AppConfig;
  pool: Pool;
  users: UserService;
  economy: EconomyService;
  games: GamePlayService;
  pets: PetService;
  flags: FeatureFlags;
}

export function registerApi(app: FastifyInstance, deps: ApiDeps): void {
  app.addHook("onRequest", async (req, reply) => {
    const ip = req.ip;
    const limit = apiLimiter.take(ip);
    if (!limit.ok) {
      return fail(reply, 429, "RATE_LIMIT", String(limit.retryAfterSec));
    }
  });

  app.get("/api/health", async () => ({ success: true, data: { ok: true } }));

  app.post("/api/auth/register", async (req, reply) => {
    const limit = authLimiter.take(req.ip);
    if (!limit.ok) return fail(reply, 429, "RATE_LIMIT");
    const body = z.object({ email: emailSchema, password: passwordSchema, username: usernameSchema }).safeParse(req.body);
    if (!body.success) return fail(reply, 400, "VALIDATION");
    try {
      const user = await deps.users.register(body.data.email, body.data.password, body.data.username);
      await issueSession(reply, deps, user);
      return ok(reply, publicUser(user, String(deps.cfg.STARTING_BALANCE)));
    } catch (err) {
      if (String(err).includes("duplicate") || String(err).includes("unique")) return fail(reply, 409, "EMAIL_TAKEN");
      throw err;
    }
  });

  app.post("/api/auth/login", async (req, reply) => {
    const limit = authLimiter.take(req.ip);
    if (!limit.ok) return fail(reply, 429, "RATE_LIMIT");
    const body = z.object({ email: emailSchema, password: z.string().min(1).max(100) }).safeParse(req.body);
    if (!body.success) return fail(reply, 400, "VALIDATION");
    try {
      const user = await deps.users.login(body.data.email, body.data.password);
      await issueSession(reply, deps, user);
      const bal = await deps.economy.getBalance(user.id);
      return ok(reply, publicUser(user, bal.toString()));
    } catch {
      return fail(reply, 401, "INVALID_CREDENTIALS");
    }
  });

  app.post("/api/auth/telegram", async (req, reply) => {
    const body = z.object({ initData: z.string().min(10).max(4096) }).safeParse(req.body);
    if (!body.success) return fail(reply, 400, "VALIDATION");
    try {
      const tg = verifyTelegramInitData(body.data.initData, deps.cfg.BOT_TOKEN);
      const { user } = await deps.users.ensureTelegramUser(BigInt(tg.id), tg.username);
      await issueSession(reply, deps, user);
      const bal = await deps.economy.getBalance(user.id);
      return ok(reply, publicUser(user, bal.toString()));
    } catch {
      return fail(reply, 401, "INITDATA_INVALID");
    }
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies.sid;
    if (token) await deps.users.revokeSession(token);
    clearAuth(reply, deps.cfg);
    return ok(reply, { loggedOut: true });
  });

  app.post("/api/auth/logout-all", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    await deps.users.revokeAll(user.id);
    clearAuth(reply, deps.cfg);
    return ok(reply, { loggedOut: true });
  });

  app.post("/api/auth/refresh", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    const token = req.cookies.sid;
    if (token) await deps.users.revokeSession(token);
    await issueSession(reply, deps, user);
    return ok(reply, { refreshed: true });
  });

  app.post("/api/auth/change-password", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    if (!checkCsrf(req, reply)) return;
    const body = z.object({ current: z.string().min(1), next: passwordSchema }).safeParse(req.body);
    if (!body.success) return fail(reply, 400, "VALIDATION");
    try {
      await deps.users.changePassword(user.id, body.data.current, body.data.next);
      await deps.users.revokeAll(user.id);
      await issueSession(reply, deps, user);
      return ok(reply, { changed: true });
    } catch {
      return fail(reply, 401, "INVALID_CREDENTIALS");
    }
  });

  app.get("/api/auth/me", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    const bal = await deps.economy.getBalance(user.id);
    return ok(reply, publicUser(user, bal.toString()));
  });

  app.get("/api/me", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    const bal = await deps.economy.getBalance(user.id);
    const flags = await deps.flags.all();
    return ok(reply, {
      user: publicUser(user, bal.toString()),
      flags,
      gameOfTheDay: gameOfTheDay(),
      petOfTheDay: petOfTheDay(),
      virtualNotice: true,
    });
  });

  app.get("/api/games", async (req, reply) => {
    const q = typeof req.query === "object" && req.query && "q" in req.query ? String((req.query as { q?: string }).q ?? "") : "";
    const catRaw = typeof req.query === "object" && req.query && "category" in req.query ? String((req.query as { category?: string }).category ?? "") : "";
    const category = GAME_CATEGORIES.includes(catRaw as GameCategory) ? (catRaw as GameCategory) : undefined;
    const page = Math.max(1, Number((req.query as { page?: string }).page ?? 1) || 1);
    const size = 24;
    const all = searchGames(q, category);
    const slice = all.slice((page - 1) * size, page * size).map(publicGame);
    return ok(reply, { items: slice, total: all.length, page, gameOfTheDay: publicGame(gameOfTheDay()) });
  });

  app.get("/api/games/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const game = getGame(id);
    if (!game || game.secret) return fail(reply, 404, "NOT_FOUND");
    return ok(reply, { game: publicGame(game), fairness: game.chance });
  });

  app.post("/api/games/:id/play", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    if (!checkCsrf(req, reply)) return;
    if (!(await deps.flags.get("games"))) return fail(reply, 403, "FEATURE_DISABLED");
    const limit = gameLimiter.take(user.id);
    if (!limit.ok) return fail(reply, 429, "RATE_LIMIT");
    const id = (req.params as { id: string }).id;
    const body = z.object({
      bet: z.number().int().min(0).max(1_000_000).optional(),
      requestId: z.string().min(8).max(80),
    }).safeParse(req.body);
    if (!body.success) return fail(reply, 400, "VALIDATION");
    try {
      const game = getGame(id);
      if (!game) return fail(reply, 404, "NOT_FOUND");
      const bet = game.chance ? body.data.bet ?? game.defaultBet : 0;
      const result = await deps.games.start(user.id, id, bet, body.data.requestId);
      return ok(reply, result);
    } catch (err) {
      return mapEconomyError(reply, err);
    }
  });

  app.post("/api/games/:id/finish", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    if (!checkCsrf(req, reply)) return;
    const body = z.object({
      sessionId: z.string().uuid(),
      score: z.number().int().min(0).max(1_000_000),
      durationMs: z.number().int().min(0).max(600_000),
    }).safeParse(req.body);
    if (!body.success) return fail(reply, 400, "VALIDATION");
    try {
      const result = await deps.games.finishSkill(user.id, body.data.sessionId, body.data.score, body.data.durationMs);
      return ok(reply, result);
    } catch (err) {
      return mapEconomyError(reply, err);
    }
  });

  app.get("/api/games/:id/history", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    const id = (req.params as { id: string }).id;
    return ok(reply, { items: await deps.games.history(user.id, id) });
  });

  app.get("/api/pets", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    if (!(await deps.flags.get("pets"))) return fail(reply, 403, "FEATURE_DISABLED");
    return ok(reply, { owned: await deps.pets.list(user.id), catalogSize: getPetCatalog().length, petOfTheDay: petOfTheDay() });
  });

  app.post("/api/pets/:id/action", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    if (!checkCsrf(req, reply)) return;
    const body = z.object({ action: z.enum(["feed", "play", "train", "walk", "sleep", "groom", "care", "heal", "interact"]) }).safeParse(req.body);
    if (!body.success) return fail(reply, 400, "VALIDATION");
    try {
      const pet = await deps.pets.act(user.id, (req.params as { id: string }).id, body.data.action as PetAction);
      return ok(reply, { pet });
    } catch {
      return fail(reply, 400, "PET_ACTION_FAILED");
    }
  });

  app.get("/api/wallet", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    const bal = await deps.economy.getBalance(user.id);
    const history = await deps.economy.getHistory(user.id);
    return ok(reply, { balance: bal.toString(), history, notice: "Virtual Currency — no real-world value." });
  });

  app.post("/api/rewards/daily", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    if (!checkCsrf(req, reply)) return;
    const result = await deps.users.claimDaily(user.id);
    return ok(reply, { ...result, amount: result.amount.toString() });
  });

  app.get("/api/leaderboard", async (req, reply) => {
    if (!(await deps.flags.get("leaderboard"))) return fail(reply, 403, "FEATURE_DISABLED");
    const period = String((req.query as { period?: string }).period ?? "global");
    const page = Math.max(1, Number((req.query as { page?: string }).page ?? 1) || 1);
    const size = 20;
    const offset = (page - 1) * size;
    const interval =
      period === "daily" ? "1 day" : period === "weekly" ? "7 days" : period === "monthly" ? "30 days" : null;
    const rows = interval
      ? await deps.pool.query(
          `SELECT u.id, u.username, SUM(gr.score)::int AS score
           FROM game_results gr JOIN users u ON u.id = gr.user_id
           WHERE gr.created_at > now() - $1::interval
           GROUP BY u.id ORDER BY score DESC LIMIT $2 OFFSET $3`,
          [interval, size, offset],
        )
      : await deps.pool.query(
          `SELECT id, username, xp::int AS score FROM users ORDER BY xp DESC LIMIT $1 OFFSET $2`,
          [size, offset],
        );
    return ok(reply, { items: rows.rows, page, period });
  });

  app.get("/api/quests", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    const defs = getQuestCatalog();
    const progress = await deps.pool.query("SELECT quest_id, progress, claimed_at FROM quest_progress WHERE user_id = $1", [user.id]);
    return ok(reply, { defs, progress: progress.rows });
  });

  app.get("/api/achievements", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    const unlocked = await deps.pool.query("SELECT achievement_id, unlocked_at FROM achievements WHERE user_id = $1", [user.id]);
    return ok(reply, { defs: getAchievementCatalog().filter((a) => a.kind !== "secret"), unlocked: unlocked.rows });
  });

  app.get("/api/inventory", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    const items = await deps.pool.query("SELECT item_id, qty FROM inventory WHERE user_id = $1 AND qty > 0", [user.id]);
    return ok(reply, { items: items.rows });
  });

  app.get("/api/shop", async (_req, reply) => {
    return ok(reply, {
      items: [
        { id: "boost_xp", name: "XP Boost", price: 500, kind: "boost" },
        { id: "pet_snack", name: "Pet Snack", price: 120, kind: "pet" },
        { id: "frame_neon", name: "Neon Frame", price: 900, kind: "cosmetic" },
      ],
      notice: "Virtual Currency only.",
    });
  });

  app.post("/api/shop/buy", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    if (!checkCsrf(req, reply)) return;
    if (!(await deps.flags.get("shop"))) return fail(reply, 403, "FEATURE_DISABLED");
    const body = z.object({ itemId: z.string(), requestId: z.string().min(8) }).safeParse(req.body);
    if (!body.success) return fail(reply, 400, "VALIDATION");
    const catalog: Record<string, number> = { boost_xp: 500, pet_snack: 120, frame_neon: 900 };
    const price = catalog[body.data.itemId];
    if (!price) return fail(reply, 404, "NOT_FOUND");
    try {
      await deps.economy.removeCoins({
        userId: user.id,
        amount: BigInt(price),
        type: "shop",
        idempotencyKey: `shop:${user.id}:${body.data.requestId}`,
      });
      await deps.pool.query(
        `INSERT INTO inventory (user_id, item_id, qty) VALUES ($1,$2,1)
         ON CONFLICT (user_id, item_id) DO UPDATE SET qty = inventory.qty + 1`,
        [user.id, body.data.itemId],
      );
      const bal = await deps.economy.getBalance(user.id);
      return ok(reply, { balance: bal.toString() });
    } catch (err) {
      return mapEconomyError(reply, err);
    }
  });

  app.get("/api/notifications", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    const rows = await deps.pool.query(
      "SELECT id, kind, title, body, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
      [user.id],
    );
    return ok(reply, { items: rows.rows });
  });

  app.post("/api/notifications/read-all", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    if (!checkCsrf(req, reply)) return;
    await deps.pool.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [user.id]);
    return ok(reply, { ok: true });
  });

  app.get("/api/friends", async (req, reply) => {
    const user = await requireUser(req, reply, deps);
    if (!user) return;
    const rows = await deps.pool.query(
      `SELECT f.friend_id, f.status, u.username, u.level FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = $1`,
      [user.id],
    );
    return ok(reply, { items: rows.rows });
  });

  app.get("/api/catalog/summary", async (_req, reply) => {
    return ok(reply, {
      games: getGameCatalog().length,
      pets: getPetCatalog().length,
      masteryExample: masteryLabel(0),
    });
  });
}

async function requireUser(req: FastifyRequest, reply: FastifyReply, deps: ApiDeps): Promise<UserRecord | undefined> {
  const token = req.cookies.sid;
  if (!token) {
    fail(reply, 401, "UNAUTHENTICATED");
    return undefined;
  }
  const user = await deps.users.sessionUser(token);
  if (!user) {
    fail(reply, 401, "UNAUTHENTICATED");
    return undefined;
  }
  return user;
}

function checkCsrf(req: FastifyRequest, reply: FastifyReply): boolean {
  const cookie = req.cookies.csrf;
  const header = String(req.headers["x-csrf-token"] ?? "");
  if (!cookie || !header || cookie !== header) {
    fail(reply, 403, "CSRF");
    return false;
  }
  return true;
}

async function issueSession(reply: FastifyReply, deps: ApiDeps, user: UserRecord): Promise<void> {
  const session = await deps.users.createSession(user.id);
  const csrf = randomBytes(16).toString("hex");
  const secure = deps.cfg.isProduction;
  reply.setCookie("sid", session.token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    expires: session.expiresAt,
  });
  reply.setCookie("csrf", csrf, { path: "/", httpOnly: false, sameSite: "lax", secure, expires: session.expiresAt });
}

function clearAuth(reply: FastifyReply, cfg: AppConfig): void {
  reply.clearCookie("sid", { path: "/" });
  reply.clearCookie("csrf", { path: "/" });
  void cfg;
}

function publicUser(user: UserRecord, balance: string) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    locale: user.locale,
    level: user.level,
    xp: user.xp,
    rank: user.rank_tier,
    streak: user.streak_days,
    balance,
  };
}

function publicGame(game: ReturnType<typeof getGameCatalog>[number]) {
  return {
    id: game.id,
    name: game.name,
    category: game.category,
    engine: game.engine,
    chance: game.chance,
    minBet: game.minBet,
    maxBet: game.maxBet,
    defaultBet: game.defaultBet,
    difficulty: game.difficulty,
    tutorial: game.tutorial,
    modes: game.modes,
    config: game.config,
  };
}

function ok(reply: FastifyReply, data: unknown) {
  return reply.send({ success: true, data });
}

function fail(reply: FastifyReply, status: number, code: string, extra?: string) {
  return reply.status(status).send({ success: false, error: { code, extra } });
}

function mapEconomyError(reply: FastifyReply, err: unknown) {
  const msg = String(err);
  if (msg.includes("INSUFFICIENT_FUNDS")) return fail(reply, 400, "INSUFFICIENT_FUNDS");
  if (msg.includes("BET_RANGE")) return fail(reply, 400, "BET_RANGE");
  if (msg.includes("SESSION")) return fail(reply, 409, "SESSION");
  if (msg.includes("GAME_NOT_FOUND")) return fail(reply, 404, "NOT_FOUND");
  return fail(reply, 400, "GAME_ERROR");
}
