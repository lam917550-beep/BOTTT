export const GAME_CATEGORIES = [
  "dice",
  "cards",
  "puzzle",
  "memory",
  "reaction",
  "precision",
  "arcade",
  "racing",
  "physics",
  "number",
  "strategy",
  "adventure",
  "survival",
  "pve",
  "pvp",
  "competitive",
  "casual",
  "logic",
  "retro",
  "skill",
] as const;

export type GameCategory = (typeof GAME_CATEGORIES)[number];

export const ENGINES = [
  "coin_flip",
  "dice_duel",
  "dice_over_under",
  "rps",
  "roulette_color",
  "card_war",
  "slots",
  "blackjack",
  "higher_lower",
  "memory_match",
  "simon",
  "reaction_tap",
  "precision_stop",
  "tap_race",
  "number_target",
  "sliding_tiles",
  "mines",
  "hangman",
  "unscramble",
  "sudoku4",
  "dodge_lane",
  "physics_drop",
  "tictactoe",
  "adventure_path",
  "survival_hold",
  "pve_raid",
] as const;

export type EngineId = (typeof ENGINES)[number];

export type GameMode = "practice" | "casual" | "ranked" | "challenge" | "endless" | "time_attack" | "survival" | "boss";
export type Difficulty = "easy" | "normal" | "hard" | "expert";

export interface GameDefinition {
  id: string;
  name: string;
  category: GameCategory;
  engine: EngineId;
  chance: boolean;
  minBet: number;
  maxBet: number;
  defaultBet: number;
  cooldownMs: number;
  difficulty: Difficulty;
  modes: GameMode[];
  timeLimitMs: number | null;
  config: Record<string, number | string | boolean>;
  tutorial: string;
  secret: boolean;
  new: boolean;
}

const ENGINE_META: Record<
  EngineId,
  { category: GameCategory; chance: boolean; name: string; tutorial: string; extra: Record<string, number> }
> = {
  coin_flip: { category: "casual", chance: true, name: "Coin Flip", tutorial: "Call heads or tails. Server rolls 45/55.", extra: { faces: 2 } },
  dice_duel: { category: "dice", chance: true, name: "Dice Duel", tutorial: "Roll against the bot. Highest total wins.", extra: { dice: 2 } },
  dice_over_under: { category: "dice", chance: true, name: "Over/Under", tutorial: "Pick over or under the target.", extra: { target: 7 } },
  rps: { category: "pvp", chance: true, name: "RPS Arena", tutorial: "Rock, paper, scissors vs bot with server odds.", extra: {} },
  roulette_color: { category: "casual", chance: true, name: "Color Wheel", tutorial: "Red or black. Server decides.", extra: { pockets: 37 } },
  card_war: { category: "cards", chance: true, name: "Card War", tutorial: "Highest card wins the round.", extra: { decks: 1 } },
  slots: { category: "casual", chance: true, name: "Neon Slots", tutorial: "Three reels. Server outcome, client animation.", extra: { reels: 3 } },
  blackjack: { category: "cards", chance: true, name: "Twenty-One", tutorial: "Beat the dealer without busting. Chance-weighted.", extra: { decks: 1 } },
  higher_lower: { category: "cards", chance: true, name: "Higher or Lower", tutorial: "Guess the next card direction.", extra: {} },
  memory_match: { category: "memory", chance: false, name: "Memory Match", tutorial: "Flip pairs. Score is pair count vs mistakes.", extra: { pairs: 8 } },
  simon: { category: "memory", chance: false, name: "Simon Sequence", tutorial: "Repeat the growing sequence.", extra: { startLen: 3 } },
  reaction_tap: { category: "reaction", chance: false, name: "Reaction Tap", tutorial: "Tap as soon as GO appears. Faster is better.", extra: { delayMax: 2200 } },
  precision_stop: { category: "precision", chance: false, name: "Precision Stop", tutorial: "Stop the bar on the target zone.", extra: { zone: 8 } },
  tap_race: { category: "racing", chance: false, name: "Tap Race", tutorial: "Tap to fill the race meter before time ends.", extra: { taps: 30 } },
  number_target: { category: "number", chance: false, name: "Target Sum", tutorial: "Pick numbers that sum to the target.", extra: { target: 21 } },
  sliding_tiles: { category: "puzzle", chance: false, name: "Sliding Tiles", tutorial: "Order the tiles. Daily seed available.", extra: { size: 3 } },
  mines: { category: "logic", chance: false, name: "Safe Grid", tutorial: "Reveal safe cells. Server seed.", extra: { mines: 6 } },
  hangman: { category: "logic", chance: false, name: "Word Guard", tutorial: "Guess the word with limited misses.", extra: { lives: 6 } },
  unscramble: { category: "puzzle", chance: false, name: "Unscramble", tutorial: "Unscramble the word before time runs out.", extra: {} },
  sudoku4: { category: "logic", chance: false, name: "Mini Sudoku", tutorial: "Complete the 4x4 grid.", extra: { size: 4 } },
  dodge_lane: { category: "arcade", chance: false, name: "Lane Dodge", tutorial: "Avoid obstacles. Score is survival time, capped.", extra: { lanes: 3 } },
  physics_drop: { category: "physics", chance: false, name: "Drop Align", tutorial: "Drop the piece into the goal zone.", extra: { gravity: 12 } },
  tictactoe: { category: "strategy", chance: false, name: "TicTac", tutorial: "Classic 3x3. Bot uses a mixed strategy.", extra: { size: 3 } },
  adventure_path: { category: "adventure", chance: false, name: "Path Choice", tutorial: "Pick safe routes. Seeded encounters.", extra: { rooms: 5 } },
  survival_hold: { category: "survival", chance: false, name: "Hold Out", tutorial: "Keep stamina above zero.", extra: { waves: 8 } },
  pve_raid: { category: "pve", chance: false, name: "Raid Tap", tutorial: "Deal damage in timed windows.", extra: { hp: 100 } },
};

const ADJECTIVES = [
  "Neon", "Silent", "Rapid", "Crystal", "Storm", "Lucky", "Shadow", "Solar", "Frost", "Volt",
  "Mythic", "Pixel", "Turbo", "Nova", "Amber", "Cobalt", "Jade", "Ruby", "Quantum", "Echo",
];
const NOUNS = [
  "Arena", "Circuit", "Vault", "Forge", "Garden", "Harbor", "Summit", "Lab", "Temple", "Station",
  "Arcade", "Rift", "Keep", "Market", "Basin", "Spire", "Docks", "Atelier", "Coliseum", "Outpost",
];

function uniqueName(engine: EngineId, variant: number): string {
  const adj = ADJECTIVES[variant % ADJECTIVES.length];
  const noun = NOUNS[Math.floor(variant / ADJECTIVES.length) % NOUNS.length];
  const meta = ENGINE_META[engine];
  return `${adj} ${meta.name} ${noun}`;
}

export function buildGameCatalog(): GameDefinition[] {
  const games: GameDefinition[] = [];
  let n = 0;
  for (const engine of ENGINES) {
    const meta = ENGINE_META[engine];
    for (let v = 0; v < 20; v += 1) {
      n += 1;
      const difficulty: Difficulty = v % 4 === 0 ? "easy" : v % 4 === 1 ? "normal" : v % 4 === 2 ? "hard" : "expert";
      const minBet = meta.chance ? 50 + v * 10 : 0;
      const maxBet = meta.chance ? 2000 + v * 100 : 0;
      const defaultBet = meta.chance ? Math.min(100 + v * 25, maxBet) : 0;
      const timeLimit = meta.chance ? null : 20_000 + v * 1500;
      const secret = v === 19;
      games.push({
        id: `g_${engine}_${String(v + 1).padStart(2, "0")}`,
        name: uniqueName(engine, v),
        category: (v % 7 === 0 && engine !== "coin_flip" ? GAME_CATEGORIES[v % GAME_CATEGORIES.length] : meta.category) as GameCategory,
        engine,
        chance: meta.chance,
        minBet,
        maxBet,
        defaultBet,
        cooldownMs: meta.chance ? 1500 + v * 50 : 800,
        difficulty,
        modes: meta.chance ? ["casual", "ranked"] : ["practice", "casual", "time_attack", "challenge"],
        timeLimitMs: timeLimit,
        config: {
          ...meta.extra,
          variant: v + 1,
          board: 3 + (v % 4),
          target: 10 + v,
          pairs: 6 + (v % 6),
          mines: 4 + (v % 8),
          speed: 1 + v * 0.08,
        },
        tutorial: meta.tutorial,
        secret,
        new: v < 2,
      });
    }
  }
  if (games.length < 500) {
    throw new Error(`Game catalog too small: ${games.length}`);
  }
  const ids = new Set(games.map((g) => g.id));
  if (ids.size !== games.length) throw new Error("Duplicate game ids");
  void n;
  return games;
}

let catalog: GameDefinition[] | undefined;
const byId = new Map<string, GameDefinition>();

export function getGameCatalog(): GameDefinition[] {
  if (!catalog) {
    catalog = buildGameCatalog();
    for (const g of catalog) byId.set(g.id, g);
  }
  return catalog;
}

export function getGame(id: string): GameDefinition | undefined {
  getGameCatalog();
  return byId.get(id);
}

export function searchGames(query: string, category?: GameCategory): GameDefinition[] {
  const q = query.trim().toLowerCase();
  return getGameCatalog().filter((g) => {
    if (g.secret) return false;
    if (category && g.category !== category) return false;
    if (!q) return true;
    return g.name.toLowerCase().includes(q) || g.id.includes(q) || g.engine.includes(q);
  });
}

export function gameOfTheDay(now = new Date()): GameDefinition {
  const list = getGameCatalog().filter((g) => !g.secret);
  const day = Math.floor(now.getTime() / 86_400_000);
  const game = list[day % list.length];
  if (!game) throw new Error("empty catalog");
  return game;
}

export function validateGameCatalog(): string[] {
  const errors: string[] = [];
  const list = getGameCatalog();
  if (list.length < 500) errors.push(`expected >=500 games, got ${list.length}`);
  const engines = new Set(list.map((g) => g.engine));
  if (engines.size < 20) errors.push("too few engines");
  return errors;
}
