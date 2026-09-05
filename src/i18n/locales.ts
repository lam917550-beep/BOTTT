export const LOCALES = ["vi", "en", "zh", "ja", "ko", "es", "fr", "de", "ru", "pt"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "vi";

export const LOCALE_LABELS: Record<Locale, string> = {
  vi: "Tiếng Việt",
  en: "English",
  zh: "简体中文",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  ru: "Русский",
  pt: "Português",
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function parseLocale(value: unknown, fallback: Locale = DEFAULT_LOCALE): Locale {
  if (typeof value === "string" && isLocale(value)) return value;
  return fallback;
}
