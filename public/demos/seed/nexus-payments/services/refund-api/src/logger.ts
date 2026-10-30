/**
 * Structured logging for the refund API: one JSON line per event, written to stdout and shipped to the log platform.
 * Logs are stored data (SEC-POL-001 clause 4.6): see CLR-WIKI-014 for what may go in them.
 */
export type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogSink {
  write(line: string): void;
}

let sink: LogSink = { write: (line) => process.stdout.write(line + "\n") };
let threshold: Level = (process.env.LOG_LEVEL as Level) || "info";

export function setSink(next: LogSink): void {
  sink = next;
}

export function setLevel(next: Level): void {
  threshold = next;
}

function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < ORDER[threshold]) return;
  sink.write(JSON.stringify({ ts: new Date().toISOString(), level, service: "refund-api", message, ...fields }));
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => log("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => log("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => log("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => log("error", message, fields),
};
