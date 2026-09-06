import { Bot, GrammyError, InlineKeyboard, type Context } from "grammy";
import type { Pool } from "pg";
import type { AppConfig } from "../config/env.js";
import { withFooter } from "../i18n/format.js";
import { t, type MessageKey } from "../i18n/messages.js";
import { isLocale, LOCALES, LOCALE_LABELS, type Locale } from "../i18n/locales.js";
import { UserService, type UserRecord } from "../users/service.js";
import { EconomyService } from "../economy/service.js";
import { AiService, GeminiProvider } from "../ai/gemini.js";
import { OwnerNotifier } from "../owner/notify.js";
import { FeatureFlags } from "../owner/flags.js";
import { commandRegistry } from "./registry.js";
import { helpKeyboard, parseCallback } from "./callbacks.js";
import { renderHelpPage } from "./help.js";
import { fetchWeather, weatherCache } from "../util/weather.js";
import { aiLimiter, commandLimiter, imgLimiter } from "../security/ratelimit.js";
import { LruCache } from "../cache/lru.js";
import type { Logger } from "../logging/logger.js";

const startMs = Date.now();
const cooldown = new LruCache<string, number>(20_000, 60_000);

export interface BotDeps {
  cfg: AppConfig;
  pool: Pool;
  users: UserService;
  economy: EconomyService;
  ai: AiService;
  gemini: GeminiProvider;
  flags: FeatureFlags;
  log: Logger;
}

export function createBot(deps: BotDeps): { bot: Bot; owner: OwnerNotifier } {
  const bot = new Bot(deps.cfg.BOT_TOKEN);
  const owner = new OwnerNotifier(bot, deps.cfg.ownerTelegramId);

  bot.catch((err) => {
    deps.log.error("bot.error", { error: String(err.error) });
    void owner.send("WARNING", "bot.error", `Bot error: ${String(err.error)}`);
    if (err.error instanceof GrammyError) return;
  });

  bot.use(async (ctx, next) => {
    const from = ctx.from?.id;
    if (from) {
      const limit = commandLimiter.take(`tg:${from}`);
      if (!limit.ok) {
        const user = await safeUser(deps, ctx);
        const locale = user ? deps.users.localeOf(user) : "vi";
        if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: t("errors.rateLimit", locale, { seconds: limit.retryAfterSec }) });
        else if (ctx.message) await reply(ctx, locale, t("errors.rateLimit", locale, { seconds: limit.retryAfterSec }));
        return;
      }
    }
    await next();
  });

  bot.command("start", async (ctx) => {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    const webOk = isValidWebAppUrl(deps.cfg.WEBAPP_URL);
    const kb = startKeyboard(locale, webOk, deps.cfg.WEBAPP_URL);
    await ctx.reply(withFooter(startText(locale), locale), { reply_markup: kb });
  });

  bot.command("menu", async (ctx) => {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    await ctx.reply(withFooter(t("menu.title", locale), locale), {
      reply_markup: startKeyboard(locale, isValidWebAppUrl(deps.cfg.WEBAPP_URL), deps.cfg.WEBAPP_URL),
    });
  });

  bot.command("help", async (ctx) => {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    const query = ctx.match?.toString().trim();
    const page = renderHelpPage(locale, 1, query || undefined);
    await ctx.reply(withFooter(page.text, locale), { reply_markup: helpKeyboard(page.page, page.total) });
  });

  bot.command("language", async (ctx) => {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    await ctx.reply(withFooter(t("language.title", locale), locale), { reply_markup: languageKeyboard() });
  });

  bot.command("commands", async (ctx) => {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    const list = commandRegistry.publicList().map((c) => `/${c.name}`).join("\n");
    await ctx.reply(withFooter(`${t("commands.title", locale)}\n${list}`, locale));
  });

  bot.command("cmdinfo", async (ctx) => {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    const name = ctx.match?.toString().trim().replace(/^\//, "");
    if (!name) {
      await ctx.reply(withFooter(t("cmdinfo.usage", locale), locale));
      return;
    }
    const meta = commandRegistry.get(name);
    if (!meta || meta.ownerOnly) {
      await ctx.reply(withFooter(t("cmdinfo.unknown", locale), locale));
      return;
    }
    await ctx.reply(withFooter(`/${meta.name} — ${t(meta.descriptionKey, locale)}`, locale));
  });

  bot.command("ping", async (ctx) => {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    if (blockedCooldown(ctx, "ping", 2000, locale)) return;
    const ms = Date.now() - (ctx.message?.date ?? 0) * 1000;
    await ctx.reply(
      withFooter(t("ping.ok", locale, { ms: Math.max(0, ms), uptime: formatUptime() }), locale),
    );
  });

  bot.command("status", async (ctx) => {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
    await ctx.reply(withFooter(t("status.ok", locale, { uptime: formatUptime(), rss }), locale));
  });

  bot.command("game", async (ctx) => {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    if (!isValidWebAppUrl(deps.cfg.WEBAPP_URL)) {
      await ctx.reply(withFooter(t("game.webappMissing", locale), locale));
      return;
    }
    const kb = new InlineKeyboard().webApp(t("btn.openMiniApp", locale), `${deps.cfg.WEBAPP_URL}/#/games`);
    await ctx.reply(withFooter(t("games.intro", locale), locale), { reply_markup: kb });
  });

  bot.command("games", async (ctx) => {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    if (!isValidWebAppUrl(deps.cfg.WEBAPP_URL)) {
      await ctx.reply(withFooter(t("game.webappMissing", locale), locale));
      return;
    }
    const kb = new InlineKeyboard().webApp(t("btn.openMiniApp", locale), `${deps.cfg.WEBAPP_URL}/#/games`);
    await ctx.reply(withFooter(t("games.intro", locale) + "\n" + t("fairness.notice", locale), locale), {
      reply_markup: kb,
    });
  });

  bot.command("profile", async (ctx) => {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    const bal = await deps.economy.getBalance(user.id);
    await ctx.reply(
      withFooter(
        t("profile.card", locale, {
          level: user.level,
          rank: user.rank_tier,
          coins: bal.toString(),
          streak: user.streak_days,
        }),
        locale,
      ),
    );
  });

  bot.command("weather", async (ctx) => {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    const city = ctx.match?.toString().trim();
    if (!city) {
      await ctx.reply(withFooter(t("weather.needCity", locale), locale));
      return;
    }
    const key = city.toLowerCase();
    try {
      const cached = weatherCache.get(key);
      const data = cached ?? (await fetchWeather(city, deps.cfg.WEATHER_TIMEOUT_MS));
      if (!cached) weatherCache.set(key, data);
      await ctx.reply(withFooter(t("weather.result", locale, data), locale));
    } catch {
      await ctx.reply(withFooter(t("weather.failed", locale), locale));
    }
  });

  bot.command("alarm", async (ctx) => {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    const raw = ctx.match?.toString().trim() ?? "";
    const parts = raw.split(/\s+/);
    const op = parts[0]?.toLowerCase();
    if (!op) {
      await ctx.reply(withFooter(t("alarm.usage", locale), locale));
      return;
    }
    if (op === "list") {
      const rows = await deps.pool.query<{ id: string; fire_at: Date; text: string; paused: boolean }>(
        "SELECT id, fire_at, text, paused FROM alarms WHERE user_id = $1 ORDER BY fire_at ASC LIMIT 20",
        [user.id],
      );
      if (!rows.rows.length) {
        await ctx.reply(withFooter(t("alarm.listEmpty", locale), locale));
        return;
      }
      const body = rows.rows.map((r) => `${r.id.slice(0, 8)} ${r.fire_at.toISOString()} ${r.paused ? "paused" : ""} ${r.text}`).join("\n");
      await ctx.reply(withFooter(body, locale));
      return;
    }
    if (op === "delete" && parts[1]) {
      await deps.pool.query("DELETE FROM alarms WHERE user_id = $1 AND id::text LIKE $2", [user.id, `${parts[1]}%`]);
      await ctx.reply(withFooter(t("alarm.deleted", locale, { id: parts[1] }), locale));
      return;
    }
    if (op === "pause" && parts[1]) {
      await deps.pool.query("UPDATE alarms SET paused = TRUE WHERE user_id = $1 AND id::text LIKE $2", [user.id, `${parts[1]}%`]);
      await ctx.reply(withFooter(t("alarm.paused", locale, { id: parts[1] }), locale));
      return;
    }
    if (op === "resume" && parts[1]) {
      await deps.pool.query("UPDATE alarms SET paused = FALSE WHERE user_id = $1 AND id::text LIKE $2", [user.id, `${parts[1]}%`]);
      await ctx.reply(withFooter(t("alarm.resumed", locale, { id: parts[1] }), locale));
      return;
    }
    if (op === "set" && parts[1] && /^\d{2}:\d{2}$/.test(parts[1])) {
      const [hh, mm] = parts[1].split(":").map(Number);
      const daily = parts[2]?.toLowerCase() === "daily";
      const text = parts.slice(daily ? 3 : 2).join(" ") || "Alarm";
      const fire = nextTime(hh ?? 0, mm ?? 0);
      const inserted = await deps.pool.query<{ id: string }>(
        `INSERT INTO alarms (user_id, telegram_id, fire_at, recurring, timezone, text)
         VALUES ($1,$2,$3,$4,'UTC',$5) RETURNING id`,
        [user.id, ctx.from?.id, fire, daily, text.slice(0, 180)],
      );
      await ctx.reply(withFooter(t("alarm.created", locale, { id: inserted.rows[0]?.id.slice(0, 8) ?? "", time: parts[1] }), locale));
      return;
    }
    await ctx.reply(withFooter(t("alarm.usage", locale), locale));
  });

  const aiCommands = [
    "ai",
    "chat",
    "ask",
    "explain",
    "summarize",
    "rewrite",
    "translate",
    "code",
    "debug",
    "idea",
    "story",
    "caption",
    "prompt",
    "analyze",
  ] as const;

  for (const name of aiCommands) {
    bot.command(name, async (ctx) => {
      const { user } = await ensure(deps, ctx, owner);
      const locale = deps.users.localeOf(user);
      if (!(await deps.flags.get("ai")) || !deps.gemini.enabled()) {
        await ctx.reply(withFooter(t("ai.disabled", locale), locale));
        return;
      }
      const limit = aiLimiter.take(user.id);
      if (!limit.ok) {
        await ctx.reply(withFooter(t("errors.rateLimit", locale, { seconds: limit.retryAfterSec }), locale));
        return;
      }
      const prompt = ctx.match?.toString().trim();
      if (!prompt) {
        await ctx.reply(withFooter(t("ai.needPrompt", locale), locale));
        return;
      }
      try {
        const hint = aiHint(name);
        const text = name === "chat" ? await deps.ai.chat(user.id, prompt) : await deps.ai.prompt(user.id, prompt, hint);
        await ctx.reply(withFooter(text.slice(0, 3500), locale));
      } catch (err) {
        const msg = String(err);
        void owner.send("WARNING", "gemini.fail", `Gemini failure: ${msg}`);
        const key: MessageKey = msg.includes("AI_TIMEOUT") ? "ai.timeout" : "ai.failed";
        await ctx.reply(withFooter(t(key, locale), locale));
      }
    });
  }

  bot.command("newchat", async (ctx) => {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    await deps.ai.newChat(user.id);
    await ctx.reply(withFooter(t("chat.new", locale), locale));
  });

  bot.command("clearchat", async (ctx) => {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    await deps.ai.clearChat(user.id);
    await ctx.reply(withFooter(t("chat.cleared", locale), locale));
  });

  bot.command("img", async (ctx) => {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    if (!(await deps.flags.get("images")) || !deps.gemini.enabled()) {
      await ctx.reply(withFooter(t("ai.disabled", locale), locale));
      return;
    }
    const limit = imgLimiter.take(user.id);
    if (!limit.ok) {
      await ctx.reply(withFooter(t("errors.rateLimit", locale, { seconds: limit.retryAfterSec }), locale));
      return;
    }
    const prompt = ctx.match?.toString().trim();
    if (!prompt) {
      await ctx.reply(withFooter(t("img.needPrompt", locale), locale));
      return;
    }
    try {
      const img = await deps.gemini.generateImage(prompt);
      const buf = Buffer.from(img.data, "base64");
      await ctx.replyWithPhoto(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { caption: withFooter(prompt.slice(0, 200), locale) });
    } catch (err) {
      void owner.send("WARNING", "img.fail", `Image failure: ${String(err)}`);
      await ctx.reply(withFooter(t("img.failed", locale), locale));
    }
  });

  bot.command("owner", async (ctx) => handleOwner(ctx, deps, owner, false));
  bot.command("admin", async (ctx) => handleOwner(ctx, deps, owner, true));

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const parsed = parseCallback(data);
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);

    if (parsed.type === "invalid") {
      await ctx.answerCallbackQuery({ text: t("errors.invalidCallback", locale) });
      return;
    }
    if (parsed.type === "lang") {
      if (!isLocale(parsed.locale)) {
        await ctx.answerCallbackQuery({ text: t("errors.invalidCallback", locale) });
        return;
      }
      await deps.users.setLocale(user.id, parsed.locale);
      await ctx.answerCallbackQuery({ text: t("language.updated", parsed.locale, { label: LOCALE_LABELS[parsed.locale] }) });
      await ctx.editMessageText(withFooter(startText(parsed.locale), parsed.locale), {
        reply_markup: startKeyboard(parsed.locale, isValidWebAppUrl(deps.cfg.WEBAPP_URL), deps.cfg.WEBAPP_URL),
      });
      return;
    }
    if (parsed.type === "help" || parsed.type === "help-cat") {
      const dest = parsed.type === "help" ? (parsed.op === "home" ? 1 : parsed.page) : 1;
      const category = parsed.type === "help-cat" ? parsed.category : undefined;
      const page = renderHelpPage(locale, dest, undefined, category);
      await ctx.editMessageText(withFooter(page.text, locale), { reply_markup: helpKeyboard(page.page, page.total) });
      await ctx.answerCallbackQuery();
      return;
    }
    if (parsed.type === "menu") {
      await ctx.answerCallbackQuery();
      if (parsed.target === "lang") {
        await ctx.editMessageText(withFooter(t("language.title", locale), locale), { reply_markup: languageKeyboard() });
        return;
      }
      if (parsed.target === "help") {
        const page = renderHelpPage(locale, 1);
        await ctx.editMessageText(withFooter(page.text, locale), { reply_markup: helpKeyboard(page.page, page.total) });
        return;
      }
      if (parsed.target === "game" && isValidWebAppUrl(deps.cfg.WEBAPP_URL)) {
        await ctx.editMessageText(withFooter(t("games.intro", locale), locale), {
          reply_markup: new InlineKeyboard().webApp(t("btn.openMiniApp", locale), `${deps.cfg.WEBAPP_URL}/#/games`),
        });
        return;
      }
      await ctx.editMessageText(withFooter(t("menu.title", locale), locale), {
        reply_markup: startKeyboard(locale, isValidWebAppUrl(deps.cfg.WEBAPP_URL), deps.cfg.WEBAPP_URL),
      });
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    if (!text.startsWith("/")) return next();
    const name = text.slice(1).split(/[\s@]/)[0]?.toLowerCase() ?? "";
    if (commandRegistry.get(name)) return next();
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    await ctx.reply(withFooter(t("errors.unknownCommand", locale), locale));
  });

  return { bot, owner };
}

async function handleOwner(ctx: Context, deps: BotDeps, owner: OwnerNotifier, adminAlias: boolean): Promise<void> {
  const from = ctx.from?.id;
  if (!from || BigInt(from) !== deps.cfg.ownerTelegramId) {
    const { user } = await ensure(deps, ctx, owner);
    const locale = deps.users.localeOf(user);
    await ctx.reply(withFooter(t("owner.denied", locale), locale));
    return;
  }
  const { user } = await ensure(deps, ctx, owner);
  const flags = await deps.flags.all();
  const users = await deps.pool.query("SELECT COUNT(*)::int AS n FROM users");
  const games = await deps.pool.query("SELECT value FROM global_counters WHERE key='games_played'");
  const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const body = [
    adminAlias ? "ADMIN" : "OWNER",
    `users=${users.rows[0]?.n ?? 0}`,
    `games_played=${games.rows[0]?.value ?? 0}`,
    `rss=${rss}MB`,
    `uptime=${formatUptime()}`,
    `flags=${JSON.stringify(flags)}`,
    `webapp=${deps.cfg.WEBAPP_URL}`,
    `gemini=${deps.gemini.enabled()}`,
  ].join("\n");
  await ctx.reply(body.slice(0, 3500));
  await deps.pool.query(
    "INSERT INTO admin_audit (actor_telegram_id, action, result) VALUES ($1,$2,'ok')",
    [from, adminAlias ? "admin" : "owner"],
  );
  void user;
}

function startText(locale: Locale): string {
  return [
    t("start.welcome", locale),
    t("start.intro", locale),
    t("start.owner", locale),
    "",
    t("start.chooseLang", locale),
    t("economy.virtualNotice", locale),
  ].join("\n");
}

function startKeyboard(locale: Locale, webOk: boolean, webappUrl: string) {
  const kb = new InlineKeyboard()
    .text(t("btn.ai", locale), "menu:ai")
    .text(t("btn.game", locale), "menu:game")
    .row()
    .text(t("btn.pet", locale), "menu:pet")
    .text(t("btn.rank", locale), "menu:rank")
    .row()
    .text(t("btn.quest", locale), "menu:quest")
    .text(t("btn.profile", locale), "menu:profile")
    .row()
    .text(t("btn.language", locale), "menu:lang")
    .text(t("btn.help", locale), "menu:help");
  if (webOk) kb.row().webApp(t("btn.miniapp", locale), webappUrl);
  kb.row();
  for (const loc of LOCALES) {
    kb.text(loc.toUpperCase(), `lang:${loc}`);
    if (loc === "ko" || loc === "pt") kb.row();
  }
  return kb;
}

function languageKeyboard() {
  const kb = new InlineKeyboard();
  for (const loc of LOCALES) kb.text(LOCALE_LABELS[loc], `lang:${loc}`).row();
  return kb;
}

export function isValidWebAppUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

async function ensure(deps: BotDeps, ctx: Context, owner: OwnerNotifier): Promise<{ user: UserRecord }> {
  const from = ctx.from;
  if (!from) throw new Error("NO_FROM");
  const { user, created } = await deps.users.ensureTelegramUser(BigInt(from.id), from.username);
  if (created) {
    void owner.send("INFO", `user.new.${user.id}`, `New user ${from.id} @${from.username ?? ""}`, 0);
  }
  if (await deps.flags.get("maintenance")) {
    if (BigInt(from.id) !== deps.cfg.ownerTelegramId) {
      const locale = deps.users.localeOf(user);
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: t("errors.maintenance", locale) });
      else await reply(ctx, locale, t("errors.maintenance", locale));
      throw new Error("MAINTENANCE");
    }
  }
  return { user };
}

async function safeUser(deps: BotDeps, ctx: Context): Promise<UserRecord | undefined> {
  if (!ctx.from) return undefined;
  const found = await deps.pool.query<UserRecord>(
    "SELECT id, telegram_id::text, username, email, locale, level, xp::text, rank_tier, streak_days, last_login_date::text, last_daily_claim::text FROM users WHERE telegram_id = $1",
    [ctx.from.id],
  );
  return found.rows[0];
}

async function reply(ctx: Context, locale: Locale, body: string): Promise<void> {
  if (ctx.message) await ctx.reply(withFooter(body, locale));
}

function blockedCooldown(ctx: Context, name: string, ms: number, locale: Locale): boolean {
  const id = ctx.from?.id;
  if (!id) return false;
  const key = `${id}:${name}`;
  const until = cooldown.get(key);
  const now = Date.now();
  if (until && until > now) {
    const seconds = Math.ceil((until - now) / 1000);
    void ctx.reply(withFooter(t("errors.cooldown", locale, { seconds }), locale));
    return true;
  }
  cooldown.set(key, now + ms, ms);
  return false;
}

function formatUptime(): string {
  const s = Math.floor((Date.now() - startMs) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h${m}m`;
}

function nextTime(hh: number, mm: number): Date {
  const d = new Date();
  d.setUTCHours(hh, mm, 0, 0);
  if (d.getTime() <= Date.now()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function aiHint(name: string): string | undefined {
  const map: Record<string, string> = {
    explain: "Explain clearly and concisely.",
    summarize: "Summarize the user's text.",
    rewrite: "Rewrite more clearly.",
    translate: "Translate between the languages implied by the user.",
    code: "Answer with working code and brief explanation.",
    debug: "Find bugs and propose a fix.",
    idea: "Give practical ideas.",
    story: "Write a short original story.",
    caption: "Write a short caption.",
    prompt: "Improve the prompt.",
    analyze: "Analyze structured and carefully.",
    ask: "Answer the question directly.",
  };
  return map[name];
}
