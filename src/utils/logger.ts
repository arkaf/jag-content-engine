/** Logger minimale con livelli e timestamp. Nessuna dipendenza esterna. */

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): Level {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  return (["debug", "info", "warn", "error"].includes(raw) ? raw : "info") as Level;
}

function log(level: Level, message: string, meta?: unknown): void {
  if (ORDER[level] < ORDER[currentLevel()]) return;
  const time = new Date().toISOString();
  const prefix = `[${time}] ${level.toUpperCase().padEnd(5)}`;
  if (meta !== undefined) {
    console[level === "debug" ? "log" : level](`${prefix} ${message}`, meta);
  } else {
    console[level === "debug" ? "log" : level](`${prefix} ${message}`);
  }
}

export const logger = {
  debug: (m: string, meta?: unknown) => log("debug", m, meta),
  info: (m: string, meta?: unknown) => log("info", m, meta),
  warn: (m: string, meta?: unknown) => log("warn", m, meta),
  error: (m: string, meta?: unknown) => log("error", m, meta),
};
