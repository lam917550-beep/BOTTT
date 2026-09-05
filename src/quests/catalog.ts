export type QuestKind = "daily" | "weekly" | "monthly" | "game" | "pet" | "social" | "event" | "secret";

export interface QuestDefinition {
  id: string;
  kind: QuestKind;
  title: string;
  target: number;
  reward: number;
  chainNext: string | null;
}

export function getQuestCatalog(): QuestDefinition[] {
  return [
    { id: "q_daily_play", kind: "daily", title: "Play 3 games", target: 3, reward: 250, chainNext: "q_daily_win" },
    { id: "q_daily_win", kind: "daily", title: "Finish 1 game", target: 1, reward: 200, chainNext: "q_daily_claim" },
    { id: "q_daily_claim", kind: "daily", title: "Claim daily reward", target: 1, reward: 150, chainNext: null },
    { id: "q_weekly_mastery", kind: "weekly", title: "Play 15 games", target: 15, reward: 1200, chainNext: null },
    { id: "q_monthly_collector", kind: "monthly", title: "Own 5 pets", target: 5, reward: 4000, chainNext: null },
    { id: "q_game_any", kind: "game", title: "Try 5 different games", target: 5, reward: 500, chainNext: null },
    { id: "q_pet_care", kind: "pet", title: "Care for a pet 3 times", target: 3, reward: 300, chainNext: null },
    { id: "q_social_friend", kind: "social", title: "Add 1 friend", target: 1, reward: 400, chainNext: null },
    { id: "q_event_play", kind: "event", title: "Play during an event", target: 1, reward: 800, chainNext: null },
    { id: "q_secret_egg", kind: "secret", title: "Find an easter egg", target: 1, reward: 1500, chainNext: null },
  ];
}

export interface AchievementDefinition {
  id: string;
  title: string;
  kind: "normal" | "hidden" | "secret" | "rare" | "seasonal";
  description: string;
}

export function getAchievementCatalog(): AchievementDefinition[] {
  const base: AchievementDefinition[] = [
    { id: "a_first_game", title: "First Steps", kind: "normal", description: "Play your first game" },
    { id: "a_first_pet", title: "Companion", kind: "normal", description: "Receive a starter pet" },
    { id: "a_streak_7", title: "Week Warrior", kind: "rare", description: "7-day login streak" },
    { id: "a_coins_50k", title: "Vault", kind: "rare", description: "Hold 50k virtual coins" },
    { id: "a_secret_game", title: "Hidden Arcade", kind: "secret", description: "Open a secret game" },
    { id: "a_seasonal_login", title: "Season Ticket", kind: "seasonal", description: "Login during the current season" },
    { id: "a_hidden_help", title: "Help Explorer", kind: "hidden", description: "Open help page 10" },
  ];
  for (const engine of [
    "dice",
    "cards",
    "puzzle",
    "memory",
    "reaction",
    "arcade",
    "pet",
  ]) {
    base.push({
      id: `a_master_${engine}`,
      title: `${engine} specialist`,
      kind: "normal",
      description: `Play ${engine} content`,
    });
  }
  return base;
}

export const TITLES = [
  "Gamer",
  "Master",
  "Champion",
  "Legend",
  "Explorer",
  "Collector",
  "Pet Master",
  "Puzzle Master",
  "Arcade Master",
  "Speed Demon",
] as const;

export const RANK_TIERS = [
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Diamond",
  "Master",
  "Grandmaster",
  "Legend",
  "Mythic",
] as const;

export function rankForXp(xp: number): (typeof RANK_TIERS)[number] {
  if (xp >= 200_000) return "Mythic";
  if (xp >= 120_000) return "Legend";
  if (xp >= 80_000) return "Grandmaster";
  if (xp >= 50_000) return "Master";
  if (xp >= 30_000) return "Diamond";
  if (xp >= 18_000) return "Platinum";
  if (xp >= 8_000) return "Gold";
  if (xp >= 2_000) return "Silver";
  return "Bronze";
}

export function masteryLabel(xp: number): string {
  if (xp >= 5000) return "Legendary";
  if (xp >= 2500) return "Master";
  if (xp >= 1000) return "Expert";
  if (xp >= 300) return "Skilled";
  return "Novice";
}
