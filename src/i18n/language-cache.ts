import { LruCache } from "../cache/lru.js";
import { DEFAULT_LOCALE, parseLocale, type Locale } from "./locales.js";

const cache = new LruCache<string, Locale>(50_000, 6 * 60 * 60 * 1000);

export class LanguageCache {
  get(userId: string): Locale | undefined {
    return cache.get(userId);
  }

  set(userId: string, locale: Locale): void {
    cache.set(userId, parseLocale(locale, DEFAULT_LOCALE));
  }

  invalidate(userId: string): void {
    cache.delete(userId);
  }

  resolve(userId: string | undefined, stored?: string | null): Locale {
    if (userId) {
      const hit = cache.get(userId);
      if (hit) return hit;
    }
    const locale = parseLocale(stored ?? DEFAULT_LOCALE, DEFAULT_LOCALE);
    if (userId) cache.set(userId, locale);
    return locale;
  }

  sweep(): number {
    return cache.sweep();
  }

  get size(): number {
    return cache.size;
  }
}

export const languageCache = new LanguageCache();
