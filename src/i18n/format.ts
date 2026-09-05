import { t, type MessageKey } from "./messages.js";
import type { Locale } from "./locales.js";

const FOOTER_MARK = "\n\n";

export function withFooter(body: string, locale: Locale): string {
  const footer = t("footer", locale);
  const trimmed = body.trimEnd();
  if (trimmed.endsWith(footer)) return trimmed;
  return `${trimmed}${FOOTER_MARK}${footer}`;
}

export function formatMessage(key: MessageKey, locale: Locale, vars?: Record<string, string | number>): string {
  return withFooter(t(key, locale, vars), locale);
}
