import fastify from "fastify";
import cookie from "@fastify/cookie";
import { loadConfig } from "./config/env.js";
import { createPool } from "./database/pool.js";
import { registerApi } from "./server/routes.js";
import { UserService } from "./users/service.js";
import { EconomyService } from "./economy/service.js";
import { GeminiProvider } from "./ai/gemini.js";
import { AiService } from "./ai/gemini.js";
import { FeatureFlags } from "./owner/flags.js";
import { GamePlayService } from "./games/play.js";
import { PetService } from "./pets/service.js";
import { Logger } from "./logging/logger.js";

async function startServer() {
  console.log("🚀 Starting Telegram Super Bot...");
  
  // Load config
  const cfg = loadConfig();
  console.log(`✅ Config loaded (NODE_ENV: ${cfg.NODE_ENV})`);
  
  // Create database pool
  const pool = createPool(cfg);
  console.log("✅ Database pool created");
  
  // Create services
  const economy = new EconomyService(pool);
  const users = new UserService(pool, cfg, economy);
  const gemini = new GeminiProvider(cfg);
  const ai = new AiService(gemini, pool);
  const flags = new FeatureFlags(pool);
  const games = new GamePlayService(pool, economy, users);
  const pets = new PetService(pool);
  const log = new Logger(cfg.LOG_LEVEL);
  
  // Create Fastify app
  const app = fastify({
    logger: {
      level: cfg.LOG_LEVEL,
    },
  });
  
  // Register cookie plugin (QUAN TRỌNG: cần cho routes)
  await app.register(cookie, {
    secret: cfg.SESSION_SECRET,
  });
  
  // Register API routes
  registerApi(app, {
    cfg,
    pool,
    users,
    economy,
    games,
    pets,
    flags,
  });
  
  // Health check
  app.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });
  
  // Start server
  await app.listen({
    port: cfg.PORT,
    host: cfg.HOST,
  });
  
  console.log(`✅ Server running on http://${cfg.HOST}:${cfg.PORT}`);
  console.log(`✅ Health check: http://${cfg.HOST}:${cfg.PORT}/health`);
}

startServer().catch((err) => {
  console.error("❌ Failed to start server:", err);
  process.exit(1);
});
