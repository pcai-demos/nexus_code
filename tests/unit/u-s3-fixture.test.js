/**
 * U-S3-FIXTURE — the clearing batch's seed is self-consistent and its fixture discriminates (S3; s3-design.md §3, D3 (a)).
 *
 * `expected_totals.txt` is the COBOL program's own report on `clearing_input.dat`, produced by GnuCOBOL 3.2 in the IDE
 * container on 2026-10-10 (md5 4636a63cb2e20307e41574df1054e709; inputs/demo-design/evidence/session-90-s3-feasibility/).
 * The unit suite has no COBOL compiler, so it pins the same report with a reference port of the program's rules (exact
 * pence in BigInt, ROUNDED as half away from zero, the filters, the control break, the edited pictures, trailing spaces
 * trimmed), and then pins that each plausible wrong port of the program gives a different report: the fixture catches it.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIR = path.join(__dirname, "..", "..", "public", "demos", "seed", "nexus-payments", "legacy", "clearing-batch");
const INPUT = fs.readFileSync(path.join(DIR, "clearing_input.dat"), "utf8");
const EXPECTED = fs.readFileSync(path.join(DIR, "expected_totals.txt"), "utf8");

/** Division of BigInts rounded to the nearest, a half away from zero (COBOL ROUNDED), half to even, or toward zero. */
function divRound(n, d, mode) {
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  let q = an / ad;
  const r = an % ad;
  if (mode === "down") return neg ? -q : q;
  const twice = r * 2n;
  if (twice > ad || (twice === ad && (mode === "halfUp" || (mode === "halfEven" && q % 2n === 1n)))) q += 1n;
  return neg ? -q : q;
}

/** A COBOL edited number: `width` characters for the whole part (zero suppression, separators), then .99 and a sign. */
function edited(pence, wholeWidth, { trailing = true, commas = true } = {}) {
  const neg = pence < 0n;
  const a = neg ? -pence : pence;
  const whole = (a / 100n).toString();
  const shown = commas ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole;
  const body = `${shown.padStart(wholeWidth)}.${(a % 100n).toString().padStart(2, "0")}`;
  return trailing ? `${body}${neg ? "-" : " "}` : `${neg ? "-" : " "}${body}`;
}
const count = (n) => n.toLocaleString("en-GB").padStart(6);

/**
 * The report from the fixture under a set of rules. The defaults are the COBOL program's; each option is one way a port
 * can get it wrong.
 */
function report(input, o = {}) {
  const rows = input.split("\n").filter(Boolean);
  const header = rows[0].startsWith("H") ? rows[0] : null;
  const runDate = header ? header.slice(1, 9) : "00000000";
  const body = header ? rows.slice(1) : rows;
  let read = body.length + (o.headerCounted ? 1 : 0);
  let declined = 0;
  let other = 0;
  const order = [];
  const totals = {};
  for (const r of body) {
    const date = r.slice(1, 9);
    const scheme = r.slice(9, 19);
    const status = r.slice(31, 32);
    const sign = r.slice(32, 33) === "-" ? -1n : 1n;
    let amount = BigInt(r.slice(33, 44)) * (o.unsigned ? 1n : sign); // pence
    const rate = BigInt(r.slice(44, 49)); // ten-thousandths
    if (o.statusFirst && status === "D") {
      declined += 1;
      continue;
    }
    if (!o.noDateFilter && date !== runDate) {
      other += 1;
      continue;
    }
    const counted = o.onlyA ? status === "A" : o.countDeclined ? true : status !== "D";
    if (!counted) {
      if (status === "D") declined += 1;
      continue;
    }
    let feeExact = amount * rate; // pence × 1/10000
    let fee;
    if (o.float) {
      const f = (Number(amount) / 100) * (Number(rate) / 10000);
      fee = BigInt(Math.floor(f * 100 + 0.5)); // Java's Math.round on a double
    } else if (o.roundAtEnd) {
      fee = feeExact; // kept exact, rounded once per scheme below
    } else fee = divRound(feeExact, 10000n, o.rounding || "halfUp");
    if (!totals[scheme]) {
      order.push(scheme);
      totals[scheme] = { n: 0, gross: 0n, fees: 0n };
    }
    const t = totals[scheme];
    t.n += 1;
    t.gross += amount;
    t.fees += fee;
  }
  const fmt = (p, w) => edited(p, w, { trailing: !o.leadingMinus, commas: !o.noCommas });
  const lines = ["NEXUS BANK PLC - CLEARING TOTALS", `BUSINESS DATE: ${runDate.slice(0, 4)}-${runDate.slice(4, 6)}-${runDate.slice(6, 8)}`, `SCHEME       COUNT${" ".repeat(13)}GROSS${" ".repeat(12)}FEES${" ".repeat(15)}NET`];
  const g = { n: 0, gross: 0n, fees: 0n, net: 0n };
  const detail = (name, n, gross, fees, net) => `${name.padEnd(10)}  ${count(n)}  ${fmt(gross, 13)} ${fmt(fees, 11)} ${fmt(net, 13)}`;
  for (const s of order) {
    const t = totals[s];
    const fees = o.roundAtEnd ? divRound(t.fees, 10000n, "halfUp") : t.fees;
    const net = t.gross - fees;
    lines.push(detail(s.trim(), t.n, t.gross, fees, net));
    g.n += t.n;
    g.gross += t.gross;
    g.fees += fees;
    g.net += net;
  }
  lines.push(detail("TOTAL", g.n, g.gross, g.fees, g.net));
  lines.push(`READ: ${count(read)}  DECLINED: ${count(declined)}  OTHER DATE: ${count(other)}`);
  return `${lines.map((l) => (o.keepTrailingSpaces ? l.padEnd(80) : l.replace(/ +$/, ""))).join("\n")}\n`;
}

describe("U-S3-FIXTURE: the seed", () => {
  test("expected_totals.txt is the COBOL program's report (the md5 measured in the IDE container on 2026-10-10)", () => {
    assert.strictEqual(crypto.createHash("md5").update(EXPECTED).digest("hex"), "4636a63cb2e20307e41574df1054e709");
  });

  test("the reference port of the program's rules gives that report byte for byte", () => {
    assert.strictEqual(report(INPUT), EXPECTED);
  });

  test("the fixture: a header for 2026-06-24, 21 transactions, 4 declined of which 1 from another day, 3 of other dates, refunds negative", () => {
    const rows = INPUT.split("\n").filter(Boolean);
    assert.strictEqual(rows[0], "H20260624");
    const t = rows.slice(1);
    assert.strictEqual(t.length, 21);
    assert.strictEqual(t.filter((r) => r[31] === "D").length, 4);
    assert.strictEqual(t.filter((r) => r.slice(1, 9) !== "20260624").length, 3);
    // A declined record from another day: the COBOL checks the date first, so it counts as OTHER DATE.
    assert.strictEqual(t.filter((r) => r[31] === "D" && r.slice(1, 9) !== "20260624").length, 1);
    assert.ok(t.filter((r) => r[31] === "R").every((r) => r[32] === "-"));
  });
});

describe("U-S3-FIXTURE: every plausible wrong port gives a different report", () => {
  const WRONG = {
    "binary floating point with Math.round": { float: true },
    "HALF_EVEN rounding": { rounding: "halfEven" },
    "truncated fees, as the stale comment says": { rounding: "down" },
    "fees rounded once per scheme": { roundAtEnd: true },
    "only status A counted (refunds dropped)": { onlyA: true },
    "declined records counted": { countDeclined: true },
    "other business dates counted": { noDateFilter: true },
    "the header counted as read": { headerCounted: true },
    "the sign ignored": { unsigned: true },
    "a leading minus": { leadingMinus: true },
    "no thousands separators": { noCommas: true },
    "trailing spaces kept": { keepTrailingSpaces: true },
    "the status checked before the date": { statusFirst: true },
  };
  for (const [name, o] of Object.entries(WRONG)) {
    test(name, () => assert.notStrictEqual(report(INPUT, o), EXPECTED));
  }
});
