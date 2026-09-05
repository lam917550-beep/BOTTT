import { redact } from "../security/redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const rank: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  constructor(
    private level: LogLevel,
    private extras: Record<string, unknown> = {},
  ) {}

  child(extras: Record<string, unknown>): Logger {
    return new Logger(this.level, { ...this.extras, ...extras });
  }

  debug(event: string, data?: Record<string, unknown>): void {
    this.write("debug", event, data);
  }
  info(event: string, data?: Record<string, unknown>): void {
    this.write("info", event, data);
  }
  warn(event: string, data?: Record<string, unknown>): void {
    this.write("warn", event, data);
  }
  error(event: string, data?: Record<string, unknown>): void {
    this.write("error", event, data);
  }

  private write(level: LogLevel, event: string, data?: Record<string, unknown>): void {
    if (rank[level] < rank[this.level]) return;
    const payload = redact({
      ts: new Date().toISOString(),
      level,
      event,
      ...this.extras,
      ...data,
    });
    const line = JSON.stringify(payload);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
}
