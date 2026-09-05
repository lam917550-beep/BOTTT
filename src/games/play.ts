import type { Pool } from "pg";
import { getGame, type GameDefinition } from "./catalog.js";
import { EconomyService } from "../economy/service.js";
import { rollChanceWinner, secureId, secureInt } from "../security/rng.js";
import { UserService } from "../users/service.js";

export class GamePlayService {
  constructor(
    private pool: Pool,
    private economy: EconomyService,
    private users: UserService,
  ) {}

  async start(userId: string, gameId: string, bet: number, idempotencyKey: string): Promise<{
    sessionId: string;
    roundId: string;
    game: GameDefinition;
    result?: ChanceResult;
  }> {
    const game = getGame(gameId);
    if (!game) throw new Error("GAME_NOT_FOUND");
    if (game.chance) {
      if (bet < game.minBet || bet > game.maxBet) throw new Error("BET_RANGE");
    } else if (bet !== 0) {
      throw new Error("BET_NOT_ALLOWED");
    }

    const roundId = secureId();
    const seed = secureId(8);
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    if (game.chance) {
      await this.economy.placeBet(userId, BigInt(bet), game.id, roundId, `${idempotencyKey}:bet`);
      const winner = rollChanceWinner();
      const payout = winner === "player" ? BigInt(bet) * 2n : 0n;
      const settle = await this.economy.settleGame({
        userId,
        bet: BigInt(bet),
        playerWon: winner === "player",
        gameId: game.id,
        roundId,
        idempotencyKey: `${idempotencyKey}:settle`,
      });
      const session = await this.pool.query<{ id: string }>(
        `INSERT INTO game_sessions (user_id, game_id, status, bet, seed, state, expires_at)
         VALUES ($1,$2,'settled',$3,$4,$5,$6) RETURNING id`,
        [userId, game.id, bet, seed, JSON.stringify({ winner }), expires],
      );
      const sessionId = session.rows[0]?.id;
      if (!sessionId) throw new Error("SESSION_INSERT_FAILED");
      await this.pool.query(
        `INSERT INTO game_results (user_id, game_id, session_id, round_id, score, player_won, payout)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [userId, game.id, sessionId, roundId, winner === "player" ? 1 : 0, winner === "player", settle.payout.toString()],
      );
      await this.bumpStats(userId, game.id, winner === "player" ? 1 : 0);
      await this.pool.query("UPDATE global_counters SET value = value + 1 WHERE key = 'games_played'");
      const visual = chanceVisual(game, winner);
      return {
        sessionId,
        roundId,
        game,
        result: {
          winner,
          payout: Number(settle.payout),
          balance: settle.balance.toString(),
          visual,
          odds: { player: 45, bot: 55 },
        },
      };
    }

    const session = await this.pool.query<{ id: string }>(
      `INSERT INTO game_sessions (user_id, game_id, status, bet, seed, state, expires_at)
       VALUES ($1,$2,'active',0,$3,$4,$5) RETURNING id`,
      [userId, game.id, seed, JSON.stringify({ started: true }), expires],
    );
    const sessionId = session.rows[0]?.id;
    if (!sessionId) throw new Error("SESSION_INSERT_FAILED");
    return { sessionId, roundId, game };
  }

  async finishSkill(userId: string, sessionId: string, claimedScore: number, durationMs: number): Promise<{
    score: number;
    reward: bigint;
  }> {
    const res = await this.pool.query<{
      id: string;
      game_id: string;
      status: string;
      seed: string | null;
      expires_at: Date;
    }>("SELECT id, game_id, status, seed, expires_at FROM game_sessions WHERE id = $1 AND user_id = $2", [
      sessionId,
      userId,
    ]);
    const session = res.rows[0];
    if (!session) throw new Error("SESSION_NOT_FOUND");
    if (session.status !== "active") throw new Error("SESSION_CLOSED");
    if (session.expires_at.getTime() < Date.now()) throw new Error("SESSION_EXPIRED");
    const game = getGame(session.game_id);
    if (!game || game.chance) throw new Error("GAME_INVALID");

    const maxScore = maxSkillScore(game);
    const minDuration = 400;
    if (durationMs < minDuration) throw new Error("IMPOSSIBLE_TIME");
    const score = Math.max(0, Math.min(maxScore, Math.floor(claimedScore)));
    const reward = BigInt(Math.min(400, 40 + Math.floor(score / 10)));
    const roundId = secureId();

    if (reward > 0n) {
      await this.economy.addCoins({
        userId,
        amount: reward,
        type: "game_reward",
        gameId: game.id,
        roundId,
        idempotencyKey: `skill:${sessionId}`,
      });
    }
    await this.pool.query("UPDATE game_sessions SET status = 'settled', state = $2 WHERE id = $1", [
      sessionId,
      JSON.stringify({ score, durationMs }),
    ]);
    await this.pool.query(
      `INSERT INTO game_results (user_id, game_id, session_id, round_id, score, player_won, payout)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, game.id, sessionId, roundId, score, score > 0, reward.toString()],
    );
    await this.bumpStats(userId, game.id, score);
    await this.users.addXp(userId, 8 + Math.floor(score / 50));
    await this.pool.query("UPDATE global_counters SET value = value + 1 WHERE key = 'games_played'");
    return { score, reward };
  }

  async history(userId: string, gameId?: string) {
    const res = await this.pool.query(
      `SELECT round_id, game_id, score, player_won, payout, created_at
       FROM game_results WHERE user_id = $1 AND ($2::text IS NULL OR game_id = $2)
       ORDER BY created_at DESC LIMIT 30`,
      [userId, gameId ?? null],
    );
    return res.rows;
  }

  private async bumpStats(userId: string, gameId: string, score: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO personal_bests (user_id, game_id, best_score, mastery_xp, plays)
       VALUES ($1,$2,$3,$4,1)
       ON CONFLICT (user_id, game_id) DO UPDATE SET
         best_score = GREATEST(personal_bests.best_score, EXCLUDED.best_score),
         mastery_xp = personal_bests.mastery_xp + 10,
         plays = personal_bests.plays + 1,
         updated_at = now()`,
      [userId, gameId, score, 10],
    );
    await this.pool.query(
      `INSERT INTO achievements (user_id, achievement_id) VALUES ($1,'a_first_game') ON CONFLICT DO NOTHING`,
      [userId],
    );
  }
}

export interface ChanceResult {
  winner: "player" | "bot";
  payout: number;
  balance: string;
  visual: Record<string, string | number>;
  odds: { player: number; bot: number };
}

function maxSkillScore(game: GameDefinition): number {
  const variant = Number(game.config.variant ?? 1);
  return 1000 + variant * 50;
}

function chanceVisual(game: GameDefinition, winner: "player" | "bot"): Record<string, string | number> {
  if (game.engine === "coin_flip") return { face: winner === "player" ? "heads" : "tails" };
  if (game.engine === "dice_duel") {
    return {
      player: secureInt(1, 6) + (winner === "player" ? 6 : 0),
      bot: secureInt(1, 6) + (winner === "bot" ? 6 : 0),
    };
  }
  if (game.engine === "rps") {
    const picks = ["rock", "paper", "scissors"] as const;
    const player = picks[secureInt(0, 2)] ?? "rock";
    return { player, bot: winner === "player" ? loseTo(player) : winOver(player) };
  }
  if (game.engine === "slots") {
    const symbol = winner === "player" ? "7" : "x";
    return { reels: winner === "player" ? `${symbol}${symbol}${symbol}` : `${symbol}A${symbol}` };
  }
  return { outcome: winner };
}

function loseTo(pick: "rock" | "paper" | "scissors"): string {
  if (pick === "rock") return "scissors";
  if (pick === "paper") return "rock";
  return "paper";
}
function winOver(pick: "rock" | "paper" | "scissors"): string {
  if (pick === "rock") return "paper";
  if (pick === "paper") return "scissors";
  return "rock";
}
