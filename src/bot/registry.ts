import type { MessageKey } from "../i18n/messages.js";

export interface CommandMeta {
  name: string;
  aliases?: string[];
  descriptionKey: MessageKey;
  ownerOnly?: boolean;
  usesAi?: boolean;
  cooldownMs?: number;
  category: "core" | "ai" | "game" | "util" | "owner";
}

export class StaticCommandRegistry {
  private byName = new Map<string, CommandMeta>();

  constructor(commands: CommandMeta[]) {
    const seenAlias = new Set<string>();
    for (const cmd of commands) {
      const names = [cmd.name, ...(cmd.aliases ?? [])].map((n) => n.toLowerCase());
      for (const n of names) {
        if (this.byName.has(n) || seenAlias.has(n)) {
          throw new Error(`Duplicate command or alias: ${n}`);
        }
        seenAlias.add(n);
        this.byName.set(n, cmd);
      }
    }
  }

  get(name: string): CommandMeta | undefined {
    return this.byName.get(name.toLowerCase().replace(/^\//, ""));
  }

  publicList(): CommandMeta[] {
    const uniq = new Map<string, CommandMeta>();
    for (const cmd of this.byName.values()) {
      if (cmd.ownerOnly) continue;
      uniq.set(cmd.name, cmd);
    }
    return [...uniq.values()];
  }

  all(): CommandMeta[] {
    const uniq = new Map<string, CommandMeta>();
    for (const cmd of this.byName.values()) uniq.set(cmd.name, cmd);
    return [...uniq.values()];
  }
}

export const COMMANDS: CommandMeta[] = [
  { name: "start", descriptionKey: "cmd.desc.start", category: "core" },
  { name: "help", descriptionKey: "cmd.desc.help", category: "core" },
  { name: "menu", descriptionKey: "cmd.desc.menu", category: "core" },
  { name: "language", aliases: ["lang"], descriptionKey: "cmd.desc.language", category: "core" },
  { name: "commands", descriptionKey: "cmd.desc.help", category: "core" },
  { name: "cmdinfo", descriptionKey: "cmd.desc.help", category: "core" },
  { name: "ping", descriptionKey: "cmd.desc.ping", category: "util", cooldownMs: 2000 },
  { name: "status", descriptionKey: "cmd.desc.ping", category: "util", cooldownMs: 4000 },
  { name: "games", descriptionKey: "cmd.desc.help", category: "game" },
  { name: "game", descriptionKey: "cmd.desc.help", category: "game" },
  { name: "profile", descriptionKey: "cmd.desc.help", category: "core" },
  { name: "weather", descriptionKey: "cmd.desc.help", category: "util", cooldownMs: 8000 },
  { name: "alarm", descriptionKey: "cmd.desc.help", category: "util" },
  { name: "ai", descriptionKey: "cmd.desc.help", category: "ai", usesAi: true, cooldownMs: 4000 },
  { name: "chat", descriptionKey: "cmd.desc.help", category: "ai", usesAi: true, cooldownMs: 4000 },
  { name: "newchat", descriptionKey: "cmd.desc.help", category: "ai" },
  { name: "clearchat", descriptionKey: "cmd.desc.help", category: "ai" },
  { name: "img", descriptionKey: "cmd.desc.help", category: "ai", usesAi: true, cooldownMs: 15000 },
  { name: "ask", descriptionKey: "cmd.desc.help", category: "ai", usesAi: true, cooldownMs: 4000 },
  { name: "explain", descriptionKey: "cmd.desc.help", category: "ai", usesAi: true, cooldownMs: 4000 },
  { name: "summarize", descriptionKey: "cmd.desc.help", category: "ai", usesAi: true, cooldownMs: 4000 },
  { name: "rewrite", descriptionKey: "cmd.desc.help", category: "ai", usesAi: true, cooldownMs: 4000 },
  { name: "translate", descriptionKey: "cmd.desc.help", category: "ai", usesAi: true, cooldownMs: 4000 },
  { name: "code", descriptionKey: "cmd.desc.help", category: "ai", usesAi: true, cooldownMs: 4000 },
  { name: "debug", descriptionKey: "cmd.desc.help", category: "ai", usesAi: true, cooldownMs: 4000 },
  { name: "idea", descriptionKey: "cmd.desc.help", category: "ai", usesAi: true, cooldownMs: 4000 },
  { name: "story", descriptionKey: "cmd.desc.help", category: "ai", usesAi: true, cooldownMs: 4000 },
  { name: "caption", descriptionKey: "cmd.desc.help", category: "ai", usesAi: true, cooldownMs: 4000 },
  { name: "prompt", descriptionKey: "cmd.desc.help", category: "ai", usesAi: true, cooldownMs: 4000 },
  { name: "analyze", descriptionKey: "cmd.desc.help", category: "ai", usesAi: true, cooldownMs: 4000 },
  { name: "owner", descriptionKey: "cmd.desc.help", category: "owner", ownerOnly: true },
  { name: "admin", descriptionKey: "cmd.desc.help", category: "owner", ownerOnly: true },
];

export const commandRegistry = new StaticCommandRegistry(COMMANDS);
