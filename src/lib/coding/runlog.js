/**
 * src/lib/coding/runlog.js — the durable run log of the coding side (Machinery PR 1, design §7–§8; decision D8).
 *
 * One JSON line per event — a coding turn, an Apply, a test run, a reset, a record — appended to
 * nexcode-data/state/coding/runs.jsonl (the app's own subPath of the PVC: the IDE container cannot see it, and Reset
 * never clears it). The evidence record is built from these lines, and the acceptance and thinking-mode measurements
 * read them. Writing is bookkeeping: a failed append is reported to the caller, never thrown into a turn.
 */

const fs = require("fs");
const path = require("path");

const RUNLOG_FILE = path.join(process.cwd(), "nexcode-data", "state", "coding", "runs.jsonl");

/** Append one event (stamped `at`); returns `{ ok, error }` and never throws. */
function appendRun(entry, { file = RUNLOG_FILE, now = new Date() } = {}) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ at: now.toISOString(), ...entry })}\n`, "utf8");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** The events (newest last), optionally filtered; an unreadable line is skipped, a missing file is no events. */
function readRuns({ file = RUNLOG_FILE, filter = null, limit = 2000 } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || typeof e !== "object") continue;
    if (typeof filter === "function" && !filter(e)) continue;
    out.push(e);
  }
  return out.slice(-Math.max(1, limit));
}

module.exports = { RUNLOG_FILE, appendRun, readRuns };
