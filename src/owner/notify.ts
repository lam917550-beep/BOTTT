import type { Bot } from "grammy";
import { LruCache } from "../cache/lru.js";

export type OwnerLevel = "INFO" | "WARNING" | "CRITICAL";

interface OwnerAlert {
  key: string;
  level: OwnerLevel;
  text: string;
}

export class OwnerNotifier {
  private cooldown = new LruCache<string, true>(500, 5 * 60 * 1000);
  private recent: OwnerAlert[] = [];

  constructor(
    private bot: Bot,
    private ownerId: bigint,
  ) {}

  async send(level: OwnerLevel, key: string, text: string, cooldownMs = 5 * 60 * 1000): Promise<void> {
    this.recent.push({ key, level, text });
    if (this.recent.length > 200) this.recent.splice(0, this.recent.length - 200);
    if (this.cooldown.get(key)) return;
    this.cooldown.set(key, true, cooldownMs);
    const prefix = level === "CRITICAL" ? "🚨" : level === "WARNING" ? "⚠️" : "ℹ️";
    try {
      await this.bot.api.sendMessage(this.ownerId.toString(), `${prefix} [${level}] ${text}`.slice(0, 3500));
    } catch {
      /* never crash the process because owner notify failed */
    }
  }

  listRecent(): OwnerAlert[] {
    return this.recent.slice(-50);
  }
}
