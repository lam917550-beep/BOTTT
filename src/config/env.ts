import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(10000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  BOT_TOKEN: z.string().min(10),
  OWNER_TELEGRAM_ID: z.string().regex(/^\d+$/, "OWNER_TELEGRAM_ID must be a numeric Telegram user id"),
  WEBAPP_URL: z.string().url(),
  BOT_MODE: z.enum(["polling", "webhook"]).default("polling"),
  WEBHOOK_SECRET: z.string().optional().default(""),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  STARTING_BALANCE: z.coerce.number().int().min(0).default(10000),
  DAILY_RESET_TZ: z.string().default("UTC"),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  GEMINI_IMAGE_MODEL: z.string().default("gemini-2.0-flash-preview-image-generation"),
  WEATHER_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
});

export type AppConfig = z.infer<typeof envSchema> & {
  ownerTelegramId: bigint;
  isProduction: boolean;
};

let cached: AppConfig | undefined;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached && source === process.env) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const cfg: AppConfig = {
    ...parsed.data,
    ownerTelegramId: BigInt(parsed.data.OWNER_TELEGRAM_ID),
    isProduction: parsed.data.NODE_ENV === "production",
  };
  if (source === process.env) cached = cfg;
  return cfg;
}

export function resetConfigCache(): void {
  cached = undefined;
}
