import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../database/pool.js";

export type TxType =
  | "starting"
  | "daily"
  | "recovery"
  | "quest"
  | "achievement"
  | "game_bet"
  | "game_payout"
  | "game_reward"
  | "shop"
  | "gift_out"
  | "gift_in"
  | "pet"
  | "event"
  | "comeback";

export interface TransactionRow {
  id: string;
  user_id: string;
  type: TxType;
  amount: string;
  balance_before: string;
  balance_after: string;
  game_id: string | null;
  round_id: string | null;
  created_at: Date;
}

export class EconomyService {
  constructor(private pool: Pool) {}

  async getBalance(userId: string, client?: PoolClient): Promise<bigint> {
    const q = client ?? this.pool;
    const res = await q.query<{ balance: string }>("SELECT balance FROM wallets WHERE user_id = $1", [userId]);
    const row = res.rows[0];
    if (!row) throw new Error("WALLET_MISSING");
    return BigInt(row.balance);
  }

  async addCoins(params: {
    userId: string;
    amount: bigint;
    type: TxType;
    gameId?: string;
    roundId?: string;
    idempotencyKey?: string;
  }): Promise<{ balance: bigint; txId: string }> {
    if (params.amount <= 0n) throw new Error("INVALID_AMOUNT");
    return this.mutate({ ...params, delta: params.amount });
  }

  async removeCoins(params: {
    userId: string;
    amount: bigint;
    type: TxType;
    gameId?: string;
    roundId?: string;
    idempotencyKey?: string;
  }): Promise<{ balance: bigint; txId: string }> {
    if (params.amount <= 0n) throw new Error("INVALID_AMOUNT");
    return this.mutate({ ...params, delta: -params.amount });
  }

  async placeBet(userId: string, amount: bigint, gameId: string, roundId: string, idempotencyKey: string) {
    return this.removeCoins({
      userId,
      amount,
      type: "game_bet",
      gameId,
      roundId,
      idempotencyKey,
    });
  }

  async settleGame(params: {
    userId: string;
    bet: bigint;
    playerWon: boolean;
    gameId: string;
    roundId: string;
    idempotencyKey: string;
  }): Promise<{ balance: bigint; payout: bigint }> {
    const payout = params.playerWon ? params.bet * 2n : 0n;
    if (payout === 0n) {
      const balance = await this.getBalance(params.userId);
      return { balance, payout };
    }
    const result = await this.addCoins({
      userId: params.userId,
      amount: payout,
      type: "game_payout",
      gameId: params.gameId,
      roundId: params.roundId,
      idempotencyKey: params.idempotencyKey,
    });
    return { balance: result.balance, payout };
  }

  async getHistory(userId: string, limit = 30): Promise<TransactionRow[]> {
    const res = await this.pool.query<TransactionRow>(
      "SELECT id, user_id, type, amount, balance_before, balance_after, game_id, round_id, created_at FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
      [userId, Math.min(100, Math.max(1, limit))],
    );
    return res.rows;
  }

  private async mutate(params: {
    userId: string;
    delta: bigint;
    type: TxType;
    gameId?: string;
    roundId?: string;
    idempotencyKey?: string;
  }): Promise<{ balance: bigint; txId: string }> {
    return withTransaction(this.pool, async (client) => {
      if (params.idempotencyKey) {
        const existing = await client.query<{ result: { balance: string; txId: string } }>(
          "SELECT result FROM idempotency_keys WHERE id = $1 AND expires_at > now()",
          [params.idempotencyKey],
        );
        const hit = existing.rows[0];
        if (hit) {
          return { balance: BigInt(hit.result.balance), txId: hit.result.txId };
        }
      }

      const wallet = await client.query<{ balance: string; version: number }>(
        "SELECT balance, version FROM wallets WHERE user_id = $1 FOR UPDATE",
        [params.userId],
      );
      const row = wallet.rows[0];
      if (!row) throw new Error("WALLET_MISSING");
      const before = BigInt(row.balance);
      const after = before + params.delta;
      if (after < 0n) throw new Error("INSUFFICIENT_FUNDS");

      const upd = await client.query(
        "UPDATE wallets SET balance = $1, version = version + 1, updated_at = now() WHERE user_id = $2 AND version = $3",
        [after.toString(), params.userId, row.version],
      );
      if (upd.rowCount !== 1) throw new Error("WALLET_CONFLICT");

      const tx = await client.query<{ id: string }>(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, game_id, round_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          params.userId,
          params.type,
          params.delta.toString(),
          before.toString(),
          after.toString(),
          params.gameId ?? null,
          params.roundId ?? null,
        ],
      );
      const txId = tx.rows[0]?.id;
      if (!txId) throw new Error("TX_INSERT_FAILED");

      if (params.idempotencyKey) {
        await client.query(
          `INSERT INTO idempotency_keys (id, user_id, result, expires_at)
           VALUES ($1,$2,$3, now() + interval '24 hours')
           ON CONFLICT (id) DO NOTHING`,
          [params.idempotencyKey, params.userId, JSON.stringify({ balance: after.toString(), txId })],
        );
      }

      return { balance: after, txId };
    });
  }
}
