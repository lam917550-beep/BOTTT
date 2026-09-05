import { t } from "../i18n/messages.js";
import type { Locale } from "../i18n/locales.js";
import { commandRegistry } from "./registry.js";
import { LruCache } from "../cache/lru.js";

const PAGE_SIZE = 6;
const helpCache = new LruCache<string, string[]>(200, 10 * 60 * 1000);

export function helpPages(locale: Locale, query?: string, category?: string): string[] {
  const cacheKey = `${locale}:${category ?? ""}:${query ?? ""}`;
  const hit = helpCache.get(cacheKey);
  if (hit) return hit;
  const cmds = commandRegistry.publicList().filter((c) => {
    if (category && c.category !== category) return false;
    if (query) {
      const q = query.toLowerCase();
      return c.name.includes(q) || t(c.descriptionKey, locale).toLowerCase().includes(q);
    }
    return true;
  });
  const lines = cmds.map((c) => `/${c.name} — ${t(c.descriptionKey, locale)}`);
  const intro = [
    t("help.title", locale),
    "",
    t("start.intro", locale),
    t("fairness.notice", locale),
    t("economy.virtualNotice", locale),
  ];
  const cats = ["core", "game", "ai", "util"].map((c) => `• ${c}`);
  const allLines = [...intro, "", ...cats, "", ...lines];
  const pages: string[] = [];
  for (let i = 0; i < allLines.length; i += PAGE_SIZE) {
    pages.push(allLines.slice(i, i + PAGE_SIZE).join("\n"));
  }
  if (pages.length === 0) pages.push(t("help.empty", locale));
  helpCache.set(cacheKey, pages);
  return pages;
}

export function renderHelpPage(locale: Locale, page: number, query?: string, category?: string): {
  text: string;
  page: number;
  total: number;
} {
  const pages = helpPages(locale, query, category);
  const total = pages.length;
  const idx = Math.min(Math.max(1, page), total);
  const body = pages[idx - 1] ?? t("help.empty", locale);
  const header = t("help.page", locale, { page: idx, total });
  return { text: `${header}\n\n${body}`, page: idx, total };
}

export function invalidateHelpCache(): void {
  helpCache.clear();
}
