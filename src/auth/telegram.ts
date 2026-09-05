import { createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramInitUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}

export function verifyTelegramInitData(initData: string, botToken: string, maxAgeSec = 86400): TelegramInitUser {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("INITDATA_MISSING_HASH");
  params.delete("hash");
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheck = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secret).update(dataCheck).digest("hex");
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("INITDATA_INVALID");
  const authDate = Number(params.get("auth_date") ?? "0");
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > maxAgeSec) {
    throw new Error("INITDATA_EXPIRED");
  }
  const rawUser = params.get("user");
  if (!rawUser) throw new Error("INITDATA_NO_USER");
  const parsed = JSON.parse(rawUser) as TelegramInitUser;
  if (!parsed.id) throw new Error("INITDATA_NO_USER");
  return parsed;
}
