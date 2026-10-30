/**
 * U-COBOL-LAYOUT — a COBOL program's record and report layouts, computed from its DATA DIVISION
 * (src/lib/coding/cobol_layout.js; S3, the clearing batch migration).
 *
 * The feasibility measurement of 2026-10-10 (inputs/demo-design/evidence/session-90-s3-feasibility/) found the code
 * model miscounting the input record's columns when it had only the source; the positions are a fact of the source, so
 * a tool computes them. Pinned on the seed's CLEARING.cbl: every column of the input record and of the report lines,
 * the literals exactly as written (their spaces are output), the editing symbols explained once, and an item the tool
 * cannot lay out reported, never guessed.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const L = require("../../src/lib/coding/cobol_layout");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "public", "demos", "seed", "nexus-payments", "legacy", "clearing-batch", "CLEARING.cbl"), "utf8");
const cols = (rec) => rec.fields.map((f) => `${f.start}-${f.end} ${f.name}`);

describe("U-COBOL-LAYOUT: pictures", () => {
  test("widths: repeats written out, S and V take no column, a separate sign takes one", () => {
    assert.strictEqual(L.expandPicture("S9(3)V99"), "S999V99");
    assert.strictEqual(L.pictureWidth("X(10)"), 10);
    assert.strictEqual(L.pictureWidth("S9(9)V99"), 11);
    assert.strictEqual(L.pictureWidth("S9(9)V99", { signSeparate: true }), 12);
    assert.strictEqual(L.pictureWidth("9V9(4)"), 5);
    assert.strictEqual(L.pictureWidth("Z,ZZZ,ZZZ,ZZ9.99-"), 17);
    assert.strictEqual(L.pictureWidth("ZZ,ZZ9"), 6);
  });

  test("meanings: text, numbers with an implied point and a separate sign, edited numbers", () => {
    assert.strictEqual(L.describePicture("X"), "text, 1 character");
    assert.strictEqual(L.describePicture("9(8)"), "number: 8 digits");
    assert.strictEqual(L.describePicture("9V9(4)"), "number: 1 digit before an implied decimal point and 4 after it (no point is stored)");
    assert.strictEqual(L.describePicture("S9(9)V99", { signSeparate: true }), "number: a separate leading sign character (+ or -), then 9 digits before an implied decimal point and 2 after it (no point is stored)");
    assert.match(L.describePicture("ZZZ,ZZZ,ZZ9.99-"), /^edited number \(15 characters/);
  });
});

describe("U-COBOL-LAYOUT: the clearing batch", () => {
  const recs = L.recordLayouts(SOURCE);
  const rec = (name) => recs.find((r) => r.name === name);

  test("the input record: 49 characters, the amount in columns 33-44 behind a separate leading sign", () => {
    assert.deepStrictEqual(cols(rec("IN-REC")), ["1-1 IN-TYPE", "2-9 IN-BUS-DATE", "10-19 IN-SCHEME", "20-31 IN-TXN-ID", "32-32 IN-STATUS", "33-44 IN-AMOUNT", "45-49 IN-FEE-RATE"]);
    assert.strictEqual(rec("IN-REC").width, 49);
    assert.strictEqual(rec("IN-REC").fields[5].signSeparate, true);
    // The fixture's records are exactly that wide.
    const fixture = fs.readFileSync(path.join(path.dirname(require.resolve("../../public/demos/seed/nexus-payments/legacy/clearing-batch/CLEARING.cbl")), "clearing_input.dat"), "utf8").split("\n").filter((l) => l.startsWith("T"));
    assert.ok(fixture.length === 21 && fixture.every((l) => l.length === 49));
  });

  test("the report lines: the detail line's columns, and every literal with its spaces (they are output)", () => {
    assert.deepStrictEqual(cols(rec("RPT-DETAIL")), ["1-10 RD-SCHEME", "11-12 FILLER", "13-18 RD-COUNT", "19-20 FILLER", "21-37 RD-GROSS", "38-38 FILLER", "39-53 RD-FEES", "54-54 FILLER", "55-71 RD-NET"]);
    assert.strictEqual(rec("RPT-HEADINGS").fields[0].value, '"SCHEME       COUNT"');
    assert.deepStrictEqual(rec("RPT-COUNT-LINE").fields.filter((f) => f.value).map((f) => f.value), ['"READ: "', '"  DECLINED: "', '"  OTHER DATE: "']);
    assert.strictEqual(rec("RPT-TITLE").value, '"NEXUS BANK PLC - CLEARING TOTALS"');
  });

  test("the expected report agrees with the layouts: each detail line is the detail record's width before trailing spaces go", () => {
    const report = fs.readFileSync(path.join(__dirname, "..", "..", "public", "demos", "seed", "nexus-payments", "legacy", "clearing-batch", "expected_totals.txt"), "utf8").split("\n");
    const details = report.filter((l) => /^(AMEX|MASTERCARD|VISA|TOTAL)\b/.test(l));
    assert.strictEqual(details.length, 4);
    for (const l of details) assert.ok(l.length <= 71 && l.length >= 70, l);
    assert.ok(!report.some((l) => / $/.test(l)), "no trailing spaces");
  });

  test("the block names the records asked for, says it is a tool's, and explains the editing symbols once", () => {
    const { text, records } = L.layoutBlock(SOURCE, { names: ["IN-REC", "RPT-DETAIL"] });
    assert.deepStrictEqual(records.map((r) => r.name), ["IN-REC", "RPT-DETAIL"]);
    assert.match(text, /^RECORD AND REPORT LAYOUTS — computed by a tool from the program's DATA DIVISION, verified by tool/);
    assert.match(text, /- columns 33-44 \(12\): IN-AMOUNT PIC S9\(9\)V99 SIGN LEADING SEPARATE — number: a separate leading sign character/);
    assert.strictEqual(text.match(/Editing symbols in an edited number/g).length, 1);
    assert.doesNotMatch(text, /WS-EOF/, "only the records asked for");
  });

  test("a mixed record shows as a line template, one placeholder per data item; a constant record prints whole (measured: Rust format strings miscounted the fields)", () => {
    const { text } = L.layoutBlock(SOURCE, { names: ["RPT-HEADINGS", "RPT-DETAIL", "RPT-COUNT-LINE"] });
    assert.match(text, /- as a line: "\{RD-SCHEME\}  \{RD-COUNT\}  \{RD-GROSS\} \{RD-FEES\} \{RD-NET\}" \(5 data items, each \{NAME\} the item at its full width\)/);
    assert.match(text, /- as a line: "READ: \{RC-READ\}  DECLINED: \{RC-DECLINED\}  OTHER DATE: \{RC-OTHER\}" \(3 data items/);
    assert.match(text, /- as it prints, every character literal[^:]*: "SCHEME       COUNT             GROSS            FEES               NET"/);
    assert.strictEqual(L.assemblyText(L.recordLayouts(SOURCE).find((r) => r.name === "IN-REC")), null, "a record of data items only needs no assembly line");
    assert.match(text, /Text items: a MOVE to a PIC X\(n\) item pads the value with spaces on the right to exactly n characters/);
  });

  test("comment lines and the PROCEDURE DIVISION are not read as data", () => {
    assert.ok(!recs.some((r) => /TRUNCATED|4111/.test(JSON.stringify(r))));
    assert.ok(L.dataSentences(SOURCE).every((s) => !/^MAIN-PARA|PERFORM/.test(s)));
  });
});

describe("U-COBOL-LAYOUT: what the tool will not guess", () => {
  test("a REDEFINES, an OCCURS or a binary item leaves its record not laid out, with the reason", () => {
    const src = [
      "       DATA DIVISION.",
      "       WORKING-STORAGE SECTION.",
      "       01  A-REC.",
      "           05 A-ONE                PIC X(3).",
      "           05 A-TWO REDEFINES A-ONE PIC 9(3).",
      "       01  B-REC.",
      "           05 B-TAB                PIC 9(2) OCCURS 5.",
      "       01  C-REC.",
      "           05 C-BIN                PIC S9(4) COMP-3.",
      "       01  D-REC.",
      "           05 D-OK                 PIC X(4).",
      "       PROCEDURE DIVISION.",
    ].join("\n");
    const recs = L.recordLayouts(src);
    assert.deepStrictEqual(recs.map((r) => [r.name, r.laidOut]), [["A-REC", false], ["B-REC", false], ["C-REC", false], ["D-REC", true]]);
    assert.match(recs[0].reason, /REDEFINES is not laid out/);
    const { text } = L.layoutBlock(src, { names: ["A-REC", "D-REC"] });
    assert.match(text, /A-REC:\n- not laid out: A-TWO: REDEFINES is not laid out by this tool/);
    assert.match(text, /D-REC \(4 characters\):/);
  });
});
