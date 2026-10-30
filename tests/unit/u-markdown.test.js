/**
 * U-MARKDOWN — the chat renders an answer's markdown (ticket T55, t55-design.md; the owner's D1 (a), D2 (a), D3 (b),
 * D4 (a); F-217).
 *
 *   1. The census (§3.1): `t55-artifacts/census55.js` — the product module (src/lib/rag/answer_markdown.js) over EVERY
 *      answer on record, rebuilt at run time: identity, order, no character lost, every table's rows and cells equal to
 *      the source's, and coded = measured (every tree equals the frozen prototype's, `probes/markdown55.js`). The
 *      census grows with the records (never below the design's 3,604 answers / 7,460 tables / 39,132 rows).
 *   2. GFM's table rules on fixed cases: the delimiter row's width, the optional outer pipes, alignment, an escaped
 *      pipe, a row wider than its header KEPT (GFM drops it), a short row, where a table ends, a cut table left as text.
 *   3. The rest of D3 (b) on fixed cases: headings, rules, quotes, bullets and numbered items with their depth (the
 *      model's own number kept), bold / italics / code pairing (an unpaired run stays text), code fences as before,
 *      totality — each fixture also through the census's no-loss check.
 *   4. Purity: no require, no I/O, no HTML.
 *   5. The panel (source pins over comment-stripped code, the U-FAIL way): the formatter is the module's tree through
 *      renderAnswerBlocks; text nodes only (no dangerouslySetInnerHTML, no innerHTML, no <img>); the code block, bullet,
 *      paragraph, bold and inline-code markup as before; the table's look (D2 (a)).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const B = (...p) => path.join(REPO_ROOT, "tests", "eval", "baselines", ...p);
const M = require("../../src/lib/rag/answer_markdown");
const { checkAnswer } = require(B("t55-artifacts", "probes", "check55.js"));
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const parse = (s) => M.parseAnswerMarkdown(s).blocks;
const shown = (tokens) => tokens.map((t) => (t.t === "text" || t.t === "code" ? t.text : `<${t.t}>${shown(t.children)}</${t.t}>`)).join("");
const cellTexts = (row) => row.map((c) => shown(c.tokens));
/** The census's check on one fixture: no problem, every character shown or named markup. */
const lossless = (s) => { const tree = M.parseAnswerMarkdown(s, { withMarkup: true }); assert.deepStrictEqual(checkAnswer(s, tree, M.textNodes(tree)).problems, [], JSON.stringify(s)); };

describe("U-MARKDOWN 1: the census — every recorded answer, the product module, coded = measured", () => {
  test("census55.js exits 0: 0 failing, every tree equal to the prototype's, never fewer answers / tables / rows than the design measured", () => {
    const { spawnSync } = require("child_process");
    const r = spawnSync(process.execPath, [B("t55-artifacts", "census55.js")], { encoding: "utf8", timeout: 120000 });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const answers = Number((/^the census: (\d+) answers from \d+ records$/m.exec(r.stdout) || [])[1]);
    const m = /^failing (\d+); tables (\d+) \(rows (\d+), cells (\d+); rows wider than the header kept whole (\d+)\)$/m.exec(r.stdout);
    const eq = /^coded = measured: (\d+) of (\d+) trees equal the prototype's \(differs (\d+)\)$/m.exec(r.stdout);
    assert.ok(m && eq, r.stdout);
    assert.ok(answers >= 3604, `answers ${answers}`);
    assert.strictEqual(Number(m[1]), 0);
    assert.ok(Number(m[2]) >= 7460 && Number(m[3]) >= 39132, `tables ${m[2]} rows ${m[3]}`);
    assert.ok(Number(m[5]) >= 1, "production's FS-1 row wider than its header is kept whole");
    assert.strictEqual(Number(eq[3]), 0);
    assert.strictEqual(Number(eq[1]), answers);
  });
});

describe("U-MARKDOWN 2: GFM tables — a header row, a delimiter row of the same width, the body rows", () => {
  test("a table: the cells, the alignment colons, bold inside a cell", () => {
    const s = "| Point | x (mm) |\n|:---|:--:|\n| **A** | 16 |\n| B | 334 |";
    const [t] = parse(s);
    assert.strictEqual(t.t, "table");
    assert.deepStrictEqual(cellTexts(t.header), ["Point", "x (mm)"]);
    assert.deepStrictEqual(t.align, ["left", "center"]);
    assert.deepStrictEqual(t.rows.map(cellTexts), [["<strong>A</strong>", "16"], ["B", "334"]]);
    assert.strictEqual(t.width, 2);
    lossless(s);
  });
  test("the outer pipes are optional; a right-aligned column", () => {
    const [t] = parse("a | b\n--|--:\n1 | 2");
    assert.strictEqual(t.t, "table");
    assert.deepStrictEqual(t.align, [null, "right"]);
    assert.deepStrictEqual(t.rows.map(cellTexts), [["1", "2"]]);
  });
  test("a delimiter row of another width is no table — the lines stay text, as GFM", () => {
    const s = "| a | b | c |\n|---|---|\n| 1 | 2 | 3 |";
    assert.deepStrictEqual(parse(s).map((b) => b.t), ["para", "para", "para"]);
    lossless(s);
  });
  test("a row wider than its header KEEPS its extra cell (production's FS-1 '| Bottom edge → A (vertical) | 220 mm | [S6]')", () => {
    const s = "| Dimension | Value |\n|---|---|\n| Top edge → B | 50 mm |\n| Bottom edge → A (vertical) | 220 mm | [S6]";
    const [t] = parse(s);
    assert.strictEqual(t.width, 3);
    assert.deepStrictEqual(cellTexts(t.rows[1]), ["Bottom edge → A (vertical)", "220 mm", "[S6]"]);
    lossless(s);
  });
  test("a short row is kept as written (the renderer pads it to the table's width)", () => {
    const [t] = parse("| a | b |\n|---|---|\n| only |");
    assert.deepStrictEqual(t.rows.map(cellTexts), [["only"]]);
    assert.strictEqual(t.width, 2);
  });
  test("an escaped pipe is a pipe inside its cell; the backslash is markup", () => {
    const s = "| a \\| b | c |\n|---|---|\n| 1 | 2 |";
    const [t] = parse(s);
    assert.deepStrictEqual(cellTexts(t.header), ["a | b", "c"]);
    lossless(s);
  });
  test("a table ends at a blank line or at a line without a pipe; a table may follow a heading directly", () => {
    const s = "## Spacing\n| a |\n|---|\n| 1 |\nClosure check: 50 + 340 + 50 = 440 mm\n\n| b |\n|---|\n| 2 |";
    assert.deepStrictEqual(parse(s).map((b) => b.t), ["heading", "table", "para", "blank", "table"]);
    lossless(s);
  });
  test("a table cut mid-delimiter (an answer stopped by the output budget) stays text, character for character", () => {
    const s = "| Button | 0 | 1 | 2 |\n|--------|---|--";
    assert.deepStrictEqual(parse(s).map((b) => b.t), ["para", "para"]);
    lossless(s);
  });
});

describe("U-MARKDOWN 3: headings, rules, quotes, lists, emphasis, code — the model's text kept whole", () => {
  test("headings # … ######; '#Title' is no heading; a closing run of #s is markup", () => {
    const b = parse("# One\n## Two\n### Three ###\n#### Four\n#Title");
    assert.deepStrictEqual(b.map((x) => x.t + (x.level || "")), ["heading1", "heading2", "heading3", "heading4", "para"]);
    assert.strictEqual(shown(b[2].tokens), "Three");
    lossless("# One\n## Two\n### Three ###\n#### Four\n#Title");
  });
  test("rules: ---, ***, * * *", () => {
    assert.deepStrictEqual(parse("---\n***\n* * *").map((x) => x.t), ["hr", "hr", "hr"]);
  });
  test("quotes: the inner line read as a line — a paragraph, a bullet, a numbered item", () => {
    const s = "> *Note:* approximate [S4]\n> - a point\n> 2. second";
    const b = parse(s);
    assert.deepStrictEqual(b.map((x) => `${x.t}/${x.inner.t}`), ["quote/para", "quote/bullet", "quote/ordered"]);
    assert.strictEqual(shown(b[0].inner.tokens), "<em>Note:</em> approximate [S4]");
    assert.strictEqual(b[2].inner.number, "2.");
    lossless(s);
  });
  test("bullets and numbered items keep their depth; the model's own number is kept, never renumbered", () => {
    const s = "1. **Floor loading**\n   - 520 kg\n   - six points\n3. Anchoring\n   Detail under the item";
    const b = parse(s);
    assert.deepStrictEqual(b.map((x) => `${x.t}:${x.depth}`), ["ordered:0", "bullet:1", "bullet:1", "ordered:0", "para:1"]);
    assert.deepStrictEqual(b.filter((x) => x.t === "ordered").map((x) => x.number), ["1.", "3."]);
    lossless(s);
  });
  test("bold, italics and code pair by CommonMark's rules; an unpaired run and snake_case stay text", () => {
    assert.strictEqual(shown(parse("**bold**, *em*, _em_ and `code`")[0].tokens), "<strong>bold</strong>, <em>em</em>, <em>em</em> and code");
    assert.strictEqual(shown(parse("- **Room Dimensions & Squa")[0].tokens), "**Room Dimensions & Squa");
    assert.strictEqual(shown(parse("Barratt_Homes_SitePlan.pdf and file_name_here")[0].tokens), "Barratt_Homes_SitePlan.pdf and file_name_here");
    assert.strictEqual(shown(parse("- *\\** Overall floor dimension")[0].tokens), "<em>*</em> Overall floor dimension");
    for (const s of ["**bold**, *em*, _em_ and `code`", "- **Room Dimensions & Squa", "- *\\** Overall floor dimension", "a ` lone tick"]) lossless(s);
  });
  test("a code fence renders as before — today's regex, language and code; a lone fence line stays text", () => {
    const b = parse("Run:\n```js\nconst a = 1 | 2;\n```\nDone");
    assert.deepStrictEqual(b.map((x) => x.t), ["para", "blank", "codeblock", "blank", "para"]);
    const code = b.find((x) => x.t === "codeblock");
    assert.strictEqual(code.language, "js");
    assert.strictEqual(code.text, "const a = 1 | 2;\n");
    assert.deepStrictEqual(parse("text\n```\nmore").map((x) => x.t), ["para", "para", "para"]);
    lossless("Run:\n```js\nconst a = 1 | 2;\n```\nDone");
    lossless("text\n```\nmore");
  });
  test("total on junk: a non-string answer is an empty tree", () => {
    assert.deepStrictEqual(M.parseAnswerMarkdown(null), { blocks: [] });
    assert.deepStrictEqual(M.parseAnswerMarkdown(undefined, { withMarkup: true }), { blocks: [], markup: [] });
  });
});

describe("U-MARKDOWN 4: purity", () => {
  test("answer_markdown.js requires nothing and touches no I/O, clock or HTML", () => {
    const src = codeOnly(fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "rag", "answer_markdown.js"), "utf8"));
    assert.ok(!/require\(/.test(src), "no require");
    assert.ok(!/\bfetch\(|Date\.now|new Date|process\.env|readFileSync|innerHTML|document\./.test(src));
  });
});

describe("U-MARKDOWN 5: the panel — the module's tree as elements with text children only (D1 a, D2 a)", () => {
  const panel = codeOnly(fs.readFileSync(path.join(REPO_ROOT, "src", "components", "ChatPanel.jsx"), "utf8"));
  const once = (needle, what) => assert.strictEqual(panel.split(needle).length - 1, 1, `${what} appears exactly once`);
  test("the formatter is the module's tree through renderAnswerBlocks; nothing is injected as HTML", () => {
    assert.match(panel, /import \{ parseAnswerMarkdown \} from "@\/lib\/rag\/answer_markdown";/);
    assert.match(panel, /const formatMessageContent = \(text\) => \{\s*if \(!text\) return null;\s*return renderAnswerBlocks\(parseAnswerMarkdown\(text\)\.blocks\);\s*\};/);
    assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(panel), "text nodes only");
    const renderer = panel.slice(panel.indexOf("function renderInline("), panel.indexOf("function AnswerWithSection("));
    assert.ok(renderer.length > 0 && !/<img\b|<a\b|href=/.test(renderer), "the renderer adds no image and no link");
  });
  test("today's markup kept: the code block, the bullet, the paragraph, the spacer, bold and inline code", () => {
    once('className="my-3 rounded-xl border border-white/10 bg-black/60 overflow-hidden font-mono text-xs w-full"', "the code block");
    once('className="bg-white/5 px-4 py-1.5 text-[10px] uppercase font-bold tracking-wider text-neutrals-medium border-b border-white/5 flex justify-between items-center select-none"', "the code block's language bar");
    once('className="p-4 overflow-x-auto whitespace-pre custom-scrollbar text-brand-soft leading-relaxed"', "the code block's pre");
    once('className="flex gap-2 pl-4 py-0.5 text-neutrals-light"', "the bullet");
    once('className="text-neutrals-light mb-1.5 leading-relaxed"', "the paragraph");
    assert.match(panel, /<strong key=\{i\} className="font-bold text-white">/);
    assert.match(panel, /const INLINE_CODE_CLASS = "bg-white\/10 px-1\.5 py-0\.5 rounded font-mono text-brand-soft text-xs";/);
  });
  test("the table's look (D2 a): its own sideways-scrolling wrapper, full width, cells wrapping between words at a 4ch minimum", () => {
    assert.match(panel, /<div key=\{index\} className="my-2 overflow-x-auto rounded-lg border border-white\/10 custom-scrollbar">\s*<table className="w-full border-collapse text-\[13px\] leading-\[1\.35\]">/);
    assert.match(panel, /<div className="min-w-\[4ch\] break-words">/);
    assert.match(panel, /scope=\{head \? "col" : undefined\}/);
  });
});
