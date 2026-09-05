import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Pool } from "pg";
import type { AppConfig } from "../config/env.js";
import { LruCache } from "../cache/lru.js";

const MAX_HISTORY = 12;
const MAX_CHARS = 4000;

export class GeminiProvider {
  private client: GoogleGenerativeAI | null = null;
  private inflight = 0;
  private readonly maxConcurrent = 4;

  constructor(private cfg: AppConfig) {
    if (cfg.GEMINI_API_KEY) this.client = new GoogleGenerativeAI(cfg.GEMINI_API_KEY);
  }

  enabled(): boolean {
    return Boolean(this.client);
  }

  async generateText(prompt: string, history: { role: "user" | "model"; text: string }[] = []): Promise<string> {
    if (!this.client) throw new Error("AI_DISABLED");
    if (this.inflight >= this.maxConcurrent) throw new Error("AI_BUSY");
    this.inflight += 1;
    try {
      return await withRetry(async () => {
        const model = this.client!.getGenerativeModel({
          model: this.cfg.GEMINI_MODEL,
          generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
        });
        const chat = model.startChat({
          history: history.slice(-MAX_HISTORY).map((h) => ({
            role: h.role,
            parts: [{ text: h.text.slice(0, MAX_CHARS) }],
          })),
        });
        const result = await withTimeout(chat.sendMessage(prompt.slice(0, MAX_CHARS)), 20_000);
        const text = result.response.text();
        if (!text) throw new Error("AI_EMPTY");
        return text;
      });
    } finally {
      this.inflight -= 1;
    }
  }

  async generateImage(prompt: string): Promise<{ mimeType: string; data: string }> {
    if (!this.client) throw new Error("AI_DISABLED");
    if (this.inflight >= this.maxConcurrent) throw new Error("AI_BUSY");
    this.inflight += 1;
    try {
      const model = this.client.getGenerativeModel({
        model: this.cfg.GEMINI_IMAGE_MODEL,
        generationConfig: { maxOutputTokens: 2048 },
      });
      const result = await withTimeout(
        model.generateContent({
          contents: [{ role: "user", parts: [{ text: `Generate an image: ${prompt.slice(0, 500)}` }] }],
        }),
        30_000,
      );
      const parts = result.response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        const inline = (part as { inlineData?: { mimeType: string; data: string } }).inlineData;
        if (inline?.data) return { mimeType: inline.mimeType || "image/png", data: inline.data };
      }
      throw new Error("IMAGE_UNSUPPORTED");
    } finally {
      this.inflight -= 1;
    }
  }
}

export class AiService {
  private convCache = new LruCache<string, string>(5_000, 30 * 60 * 1000);

  constructor(
    private gemini: GeminiProvider,
    private pool: Pool,
  ) {}

  async prompt(userId: string, text: string, systemHint?: string): Promise<string> {
    const full = systemHint ? `${systemHint}\n\n${text}` : text;
    return this.gemini.generateText(full);
  }

  async chat(userId: string, text: string): Promise<string> {
    const convId = await this.ensureConversation(userId);
    const hist = await this.pool.query<{ role: string; content: string }>(
      `SELECT role, content FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 12`,
      [convId],
    );
    const history = hist.rows
      .reverse()
      .filter((r) => r.role === "user" || r.role === "model")
      .map((r) => ({ role: r.role as "user" | "model", text: r.content }));
    const answer = await this.gemini.generateText(text, history);
    await this.pool.query("INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1,'user',$2)", [
      convId,
      text.slice(0, MAX_CHARS),
    ]);
    await this.pool.query("INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1,'model',$2)", [
      convId,
      answer.slice(0, MAX_CHARS),
    ]);
    return answer;
  }

  async newChat(userId: string): Promise<void> {
    this.convCache.delete(userId);
    await this.pool.query(
      `INSERT INTO ai_conversations (user_id, expires_at) VALUES ($1, now() + interval '12 hours')`,
      [userId],
    );
  }

  async clearChat(userId: string): Promise<void> {
    const id = this.convCache.get(userId);
    this.convCache.delete(userId);
    if (id) await this.pool.query("DELETE FROM ai_conversations WHERE id = $1 AND user_id = $2", [id, userId]);
    else await this.pool.query("DELETE FROM ai_conversations WHERE user_id = $1", [userId]);
  }

  private async ensureConversation(userId: string): Promise<string> {
    const cached = this.convCache.get(userId);
    if (cached) return cached;
    const existing = await this.pool.query<{ id: string }>(
      `SELECT id FROM ai_conversations WHERE user_id = $1 AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    const found = existing.rows[0]?.id;
    if (found) {
      this.convCache.set(userId, found);
      return found;
    }
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO ai_conversations (user_id, expires_at) VALUES ($1, now() + interval '12 hours') RETURNING id`,
      [userId],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error("CONV_INSERT_FAILED");
    this.convCache.set(userId, id);
    return id;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("AI_TIMEOUT")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = String(err);
      if (msg.includes("AI_TIMEOUT") && i + 1 < attempts) {
        await sleep(300 * 2 ** i);
        continue;
      }
      if (i + 1 >= attempts) break;
      await sleep(300 * 2 ** i);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
