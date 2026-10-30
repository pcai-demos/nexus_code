/**
 * src/lib/coding/review.js — the pull request review (S2; the owner's D2 (a) and D8 (a) of 2026-10-09).
 *
 * Pure (no I/O). A review step's turn carries the pre-merge checks' findings (scanner.js, verified by tool) and the
 * pull request's diff; the model explains them in plain language and adds its own judgement findings as a short JSON
 * list in a fenced `findings` block. This module builds the prompt's block, reads that list back (malformed or
 * out-of-change entries are dropped and counted, never guessed), merges the two kinds into one review whose outcome
 * follows REV-007 (any Critical or High finding open: "Changes requested"), and lists the findings for the IDE's
 * review comments. Tool findings are never re-graded or dropped by the model (REV-004).
 */

const { toolFindingsBlock } = require("./scanner");
const { fileDiff, diffText } = require("./diff");

const SEVERITIES = Object.freeze(["Critical", "High", "Medium", "Low"]);
const RULE_ID = /^(?:[A-Z]{2,5}-\d{3}|[A-Z]{2,5}-POL-\d{3}(?: clause \d+(?:\.\d+)*)?|ADR-\d{3}(?: D\d+)?|PM-\d{4}-\d{3}(?: L\d+)?|CLR-[A-Z0-9-]+(?: [A-Z]\d+)?|ASVS \d{1,2}\.\d{1,2}\.\d{1,2})$/;
/**
 * S6 (session-90-s6-instructions): the audit names OWASP ASVS requirements beside the Bank's rules, written "OWASP ASVS
 * 2.2.1", "ASVS 5.0.0 requirement 2.2.1" and so on; each is kept in one form, "ASVS 2.2.1". A passage marker (REG-2) is
 * not a rule and stays out.
 */
const ASVS_REF = /^(?:OWASP\s+)?ASVS(?:\s+v?5\.0\.0)?,?\s+(?:requirement\s+)?V?(\d{1,2}\.\d{1,2}\.\d{1,2})$/i;
const ruleForm = (r) => {
  const t = String(r).trim();
  const m = t.match(ASVS_REF);
  return m ? `ASVS ${m[1]}` : t;
};
const FINDINGS_FENCE = /```findings[^\n]*\n([\s\S]*?)```/i;
const MAX_ASSESSED = 12;
/**
 * The Code Review Standard's rules the review itself applies, traced like a tool finding's rule (D11 (a) of 2026-10-10):
 * the checks run first (REV-002), each finding graded (REV-003) and marked verified by tool or assessed by the reviewer
 * (REV-004), a review prepared with an AI assistant (REV-006, which traces to TEC-POL-005), the outcome and its record
 * (REV-007).
 */
const REVIEW_RULES = Object.freeze(["REV-002", "REV-003", "REV-004", "REV-006", "REV-007"]);

/**
 * The block the review prompt carries: the tool findings, then each changed file's diff against the base branch. S6:
 * `workspace` reviews the demo's own new code in the workspace, against main.
 */
function reviewBlock({ scan, files = [], base = "main", branch = "the pull request", workspace = false } = {}) {
  const parts = [toolFindingsBlock(scan)];
  const diffs = [];
  for (const f of files) {
    const fd = fileDiff(f.path, f.before, f.after);
    if (fd) diffs.push(diffText(fd, { maxLines: 300 }));
  }
  const heading = workspace ? `THE NEW CODE — the demo's files in the workspace against ${base} (a new file is every line added), as a unified diff` : `THE PULL REQUEST'S CHANGES — ${branch} against ${base}, as a unified diff`;
  parts.push(`${heading}:\n${diffs.length ? diffs.join("\n") : "(no change)"}`);
  return parts.join("\n\n");
}

/** The answer without its fenced `findings` block (the chat shows the explanation; the findings show as a table). */
function stripFindingsBlock(answer) {
  return String(answer || "").replace(FINDINGS_FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The model's own findings from its fenced `findings` block: `{ findings: [{ id: "A1"…, severity, title, path, line,
 * rules, why, established: "reviewer" }], dropped, error }`. A finding must name a changed file (its workspace path),
 * a line inside it, a severity on the REV-003 scale and a title; rule IDs that do not look like the pack's IDs are left
 * out; at most twelve are kept.
 */
function parseReviewFindings(answer, { changed = [] } = {}) {
  const m = String(answer || "").match(FINDINGS_FENCE);
  if (!m) return { findings: [], dropped: 0, error: "no findings block" };
  let list;
  try {
    list = JSON.parse(m[1]);
  } catch (err) {
    return { findings: [], dropped: 0, error: `the findings block is not JSON: ${err.message}` };
  }
  if (!Array.isArray(list)) return { findings: [], dropped: 0, error: "the findings block is not a list" };
  const byPath = new Map(changed.map((c) => [c.path, c]));
  const findings = [];
  let dropped = 0;
  for (const raw of list) {
    const x = raw && typeof raw === "object" ? raw : {};
    const filePath = typeof x.path === "string" ? x.path.trim().replace(/^\.\//, "") : "";
    const target = byPath.get(filePath) || [...byPath.values()].find((c) => c.path.endsWith(`/${filePath}`));
    const line = Number(x.line);
    const severity = SEVERITIES.find((s) => s.toLowerCase() === String(x.severity || "").trim().toLowerCase());
    const title = typeof x.title === "string" ? x.title.trim().slice(0, 160) : "";
    if (!target || !Number.isInteger(line) || line < 1 || (target.lineCount && line > target.lineCount) || !severity || !title || findings.length >= MAX_ASSESSED) {
      dropped += 1;
      continue;
    }
    const rules = (Array.isArray(x.rules) ? x.rules : typeof x.rules === "string" ? x.rules.split(/[,;]/) : []).map(ruleForm).filter((r) => RULE_ID.test(r));
    findings.push({ id: `A${findings.length + 1}`, severity, title, path: target.path, line, rules: [...new Set(rules)].slice(0, 6), why: typeof x.why === "string" ? x.why.trim().slice(0, 400) : "", established: "reviewer" });
  }
  return { findings, dropped, error: null };
}

/** REV-007: any Critical or High finding open → Changes requested; only Medium or Low → Approved with comments. */
function outcomeOf(findings) {
  const open = (findings || []).filter((f) => f.status !== "fixed");
  if (open.some((f) => f.severity === "Critical" || f.severity === "High")) return "Changes requested";
  if (open.length) return "Approved with comments";
  return "Approved";
}

/**
 * One review from the tool findings (workspace paths: `repoPrefix` + the scan's repository paths) and the model's
 * assessed findings: `{ outcome, findings, counts: { tool, reviewer, critical, high }, dropped, error }`.
 */
function mergeReview({ scan, assessed, repoPrefix = "" } = {}) {
  const tool = (scan && Array.isArray(scan.findings) ? scan.findings : []).map((f) => ({
    id: f.id,
    severity: f.severity,
    title: f.title,
    path: `${repoPrefix}${f.path}`,
    line: f.line,
    lines: f.lines,
    rules: [f.rule],
    why: f.evidence,
    check: f.check,
    established: "tool",
  }));
  const reviewer = assessed && Array.isArray(assessed.findings) ? assessed.findings : [];
  const findings = [...tool, ...reviewer];
  return {
    outcome: outcomeOf(findings),
    findings,
    counts: {
      tool: tool.length,
      reviewer: reviewer.length,
      critical: findings.filter((f) => f.severity === "Critical").length,
      high: findings.filter((f) => f.severity === "High").length,
    },
    dropped: assessed ? assessed.dropped || 0 : 0,
    error: assessed ? assessed.error || null : null,
  };
}

/**
 * S6-D9 (a) of 2026-10-13: the block a fix turn carries, the review's open findings that block the merge (REV-003: a
 * Critical finding, and a High one without a waiver), each with its id, severity, rules, place and why, computed from the
 * review's latest answer. Measured: fixes that read the findings from the replayed chat fixed 0 of 2 (one copied the
 * chat's lines instead of writing files); with this block and no history, 4 of 4 (session-90-s6-measure). `review` is
 * mergeReview's; `title` names the review in the block ("the security audit").
 */
function findingsToFixBlock(review, { title = "the review" } = {}) {
  const heading = `FINDINGS TO FIX (${title}'s open Critical and High findings, which block the merge under REV-003; T findings are verified by tool, A findings were assessed by the reviewer)`;
  if (!review || !Array.isArray(review.findings)) return `${heading}\nNone listed: ${title} has not answered since the demo was selected.`;
  const blocking = review.findings.filter((f) => f.status !== "fixed" && (f.severity === "Critical" || f.severity === "High"));
  if (blocking.length === 0) return `${heading}\nNone: ${title}'s latest answer has no Critical or High finding open.`;
  return [heading, ...blocking.map((f) => `- ${f.id} · ${f.severity} · ${(f.rules || []).join(", ") || "no rule named"} · ${f.path}:${(Array.isArray(f.lines) && f.lines.length ? f.lines : [f.line]).join(",")} · ${f.title}${f.why ? `: ${f.why}` : ""}`)].join("\n");
}

/** The findings as the IDE's review comments: one per finding, on its first line, with its severity and rules. */
function ideComments(review) {
  return ((review && review.findings) || []).map((f) => ({
    id: f.id,
    path: f.path,
    line: f.line,
    severity: f.severity,
    title: f.title,
    body: `${f.why || ""}${f.rules && f.rules.length ? `\n\nRules: ${f.rules.join(", ")}` : ""}`.trim(),
    established: f.established === "tool" ? "verified by tool" : "assessed by the reviewer",
  }));
}

/**
 * At record time: the tool findings re-checked on the current workspace. A tool finding whose check no longer reports
 * that file is "fixed" (verified by tool); a reviewer's finding stays "open" until a reviewer closes it.
 */
function statusAfterFix(review, rescan, { repoPrefix = "" } = {}) {
  const still = new Set(((rescan && rescan.findings) || []).map((f) => `${f.check}|${repoPrefix}${f.path}`));
  const findings = ((review && review.findings) || []).map((f) =>
    f.established === "tool" ? { ...f, status: still.has(`${f.check}|${f.path}`) ? "open" : "fixed" } : { ...f, status: "open" },
  );
  return { ...review, findings, outcome: outcomeOf(findings) };
}

module.exports = { SEVERITIES, REVIEW_RULES, reviewBlock, stripFindingsBlock, parseReviewFindings, outcomeOf, mergeReview, findingsToFixBlock, ideComments, statusAfterFix };
