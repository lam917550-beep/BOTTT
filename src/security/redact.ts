const SECRET_KEYS = [
  "BOT_TOKEN",
  "SESSION_SECRET",
  "GEMINI_API_KEY",
  "DATABASE_URL",
  "WEBHOOK_SECRET",
  "password",
  "token",
  "authorization",
  "cookie",
  "initData",
  "init_data",
];

const secretPattern = new RegExp(
  `(${SECRET_KEYS.join("|")})(["']?\\s*[:=]\\s*)([^\\s,;]+)`,
  "gi",
);

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(secretPattern, "$1$2[REDACTED]").replace(/postgres:\/\/[^@]+@/gi, "postgres://[REDACTED]@");
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.some((s) => k.toLowerCase().includes(s.toLowerCase()))) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}
