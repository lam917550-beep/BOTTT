import { randomBytes, randomInt } from "node:crypto";

export const PLAYER_WIN_BPS = 4500;
export const BOT_WIN_BPS = 5500;

export function secureId(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

export function rollChanceWinner(): "player" | "bot" {
  return randomInt(0, 10_000) < PLAYER_WIN_BPS ? "player" : "bot";
}

export function secureInt(min: number, max: number): number {
  return randomInt(min, max + 1);
}
