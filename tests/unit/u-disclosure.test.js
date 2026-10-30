/**
 * U-DISCLOSURE — the degradation reaches the person reading the answer
 * (finding F-34, folded into ticket T10 by the repository owner 2026-09-03).
 *
 * Why this suite exists. T10 lets unscored passages pass the relevance floor,
 * and the owner's ruling makes that conditional: "so long as the end user is
 * aware that there is uncertainty in the answer / data". Measured on main
 * before this ticket, three audiences were told and one was not:
 *
 *   the model          yes — buildRetrievalPromptBlock's degraded banner (T12)
 *   the trace drawer   yes — amber `N CHUNKS (UNRANKED: …)` badge (T12/T13)
 *   an API consumer    yes — /api/chat returns retrieval.state + degraded[]
 *   THE END USER       NO  — `grep -rn degraded page.js ChatPanel.jsx` = 0 hits
 *
 * So a turn whose passages were never relevance-ranked rendered identically to
 * a healthy one, and the ruling's entire safety argument rested on a disclosure
 * that did not exist.
 *
 * These are SOURCE-LEVEL pins, and that is a deliberate, recorded compromise:
 * the repository has no component-test harness, so T12's and T14's chips
 * shipped the same way — a structural pin plus a live /api/chat assertion
 * (I-FAILMODE's disclosure case). A pin cannot prove a pixel renders; it can
 * prove the wiring that makes rendering possible has not been silently
 * reverted, which is the failure mode that actually happened here. Building
 * the harness is proposed as a separate ticket rather than smuggled into T10.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "src");
const PAGE_JS = path.join(SRC, "app", "page.js");
const CHAT_PANEL = path.join(SRC, "components", "ChatPanel.jsx");
const CONFIG = path.join(SRC, "lib", "rag", "config.js");

const pageSrc = fs.readFileSync(PAGE_JS, "utf-8");
const panelSrc = fs.readFileSync(CHAT_PANEL, "utf-8");

/** Strip comments: a pin must be satisfied by code, never by a comment that
 *  happens to mention the right words. */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

const pageCode = codeOnly(pageSrc);
const panelCode = codeOnly(panelSrc);

describe("U-DISCLOSURE/F-34: the retrieval outcome reaches the message object", () => {
  test("page.js copies the retrieval outcome onto the AI message", () => {
    // T12 already puts `retrieval` on the /api/chat response; the gap was
    // purely that page.js never carried it onto the message ChatPanel renders.
    const copies = pageCode.match(/retrieval:\s*data\.retrieval/g) || [];
    assert.ok(
      copies.length >= 2,
      `both message builders (standard chat and IDE bridge) must carry the outcome; found ${copies.length}`
    );
  });

  test("it is copied VERBATIM, not re-derived into a local boolean", () => {
    // T12's whole lesson: never re-derive a retrieval outcome. A local
    // `isDegraded` computed in the UI is a second source of truth that can
    // disagree with the API — and with the model's prompt banner.
    assert.ok(
      !/isDegraded\s*[:=]/.test(pageCode),
      "no derived degradation flag — carry the typed outcome the API already returns"
    );
    assert.ok(
      !/retrievedChunks\.length/.test(pageCode),
      "an outcome must never be inferred from a chunk count (T12)"
    );
  });

  test("the disclosure sits beside the fields T12 and T14 already carry", () => {
    // One message shape, one convention: retrievalError (T12), citations and
    // uncitedClaims (T14), retrieval (T10).
    for (const field of ["retrievalError:", "citations:", "uncitedClaims:", "retrieval:"]) {
      assert.ok(pageCode.includes(field), `the message builder must carry ${field}`);
    }
  });
});

describe("U-DISCLOSURE/F-34: ChatPanel renders it", () => {
  test("a degraded turn is rendered, gated on the typed state", () => {
    assert.match(
      panelCode,
      /chat\.retrieval\?\.state\s*===\s*"degraded"/,
      "the chip must be gated on the typed retrieval state, not on a truthy field"
    );
  });

  test("both rerank degradation codes are worded distinctly", () => {
    // RERANK_DOWN means nothing was ranked; RERANK_PARTIAL means the ranking is
    // real but some shown passages were never checked. Telling a user "not
    // relevance-ranked" when 7 of 8 passages were properly ranked is its own
    // small dishonesty, and it trains people to ignore the chip.
    assert.match(panelCode, /RERANK_PARTIAL/, "the partial case needs its own wording");
    assert.match(panelCode, /RERANK_DOWN/, "the total case needs its own wording");
    assert.match(panelCode, /not relevance-ranked/i);
    assert.match(panelCode, /not relevance-checked/i);
  });

  test("the degradation message is carried as the tooltip", () => {
    // The route writes a human-readable sentence naming the cause and the
    // consequence; the chip must not paraphrase it.
    assert.match(
      panelCode,
      /title=\{[^}]*chat\.retrieval[\s\S]{0,60}?message/,
      "the chip's title attribute must carry retrieval.message"
    );
  });

  test("an unknown future degradation code still discloses something", () => {
    // RERANK_DOWN and RERANK_PARTIAL are today's rerank-stage codes, but the
    // degraded[] vocabulary is open. A code this component has never heard of
    // must not render as silence.
    assert.match(panelCode, /Retrieval degraded/i, "there must be a fallback label for any other code");
  });

  test("the answer bubble is visually marked, as T12 marks a retrieval failure", () => {
    const bubble = (panelCode.match(/chat\.isFailure[\s\S]{0,600}?bg-white\/3/) || [])[0];
    assert.ok(bubble, "the bubble's style ternary must still be present");
    assert.match(
      bubble,
      /chat\.retrieval\?\.state\s*===\s*"degraded"/,
      "a degraded turn must not render with the same styling as a healthy one — that IS F-34"
    );
  });

  test("the chip cannot fire on a healthy, empty, failed or legacy turn", () => {
    // Guards against the opposite error: a chip on every turn is noise, and a
    // chip on a `failed` turn would double up with T12's own failure chip.
    // `?.` is what makes a pre-T10 history entry (no `retrieval` field) safe.
    assert.ok(
      !/chat\.retrieval\s*&&/.test(panelCode),
      "a truthiness test would fire on ok/empty/failed turns alike"
    );
    assert.match(panelCode, /chat\.retrieval\?\./, "optional chaining keeps legacy history entries safe");
  });
});

describe("U-DISCLOSURE: the four audiences now agree", () => {
  const configSrc = fs.readFileSync(CONFIG, "utf-8");

  test("RERANK_PARTIAL is a typed code in the shared taxonomy, not a UI string", () => {
    assert.match(configSrc, /RERANK_PARTIAL:\s*"RERANK_PARTIAL"/, "the code must live with T12's taxonomy");
  });

  test("the model is told about a partial failure too, and differently", () => {
    const block = (configSrc.match(/case "degraded":[\s\S]{0,2000}?case "ok":/) || [])[0];
    assert.ok(block, "the degraded prompt branch must exist");
    assert.match(block, /RERANK_PARTIAL/, "the prompt must distinguish partial from total");
    assert.match(
      block,
      /NOT RELEVANCE-RANKED \(\$\{retrieval\.code\}\)/,
      "T12's total-failure banner must survive unchanged — U-FAIL pins its rendered text"
    );
  });

  test("the disclosure is not the only guard: nulls still pass the floor", () => {
    // Stated as a test so the relationship is impossible to miss when reading
    // the suite: this whole file is the precondition of that ruling.
    assert.match(
      configSrc,
      /minRerankScore/,
      "the floor still exists; T10 changes WHO it applies to, not whether it runs"
    );
  });
});
