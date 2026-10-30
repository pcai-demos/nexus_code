"use client";

import React, { useRef, useEffect, useState } from "react";
import { RiLoader4Line, RiSendPlaneFill, RiRobot2Line, RiCodeLine, RiFileAddLine, RiCheckLine, RiErrorWarningLine, RiImageLine, RiCloseLine } from "@remixicon/react";
import { formatTurnTiming } from "@/lib/rag/timing";
// Machinery PR 1 (design §4; D6, D7): the live bubble of a streaming code turn and the coding path's chips.
import CodingLiveTurn, { CodingTurnChips } from "@/components/CodingLiveTurn";
import { previewFor } from "@/lib/rag/figure_preview";
import { splitAnswer, sectionOffer } from "@/lib/rag/answer_policy";
import { parseAnswerMarkdown } from "@/lib/rag/answer_markdown";

// T55 (t55-design.md D1 a, D2 a, D3 b; F-217): an answer's markdown rendered from the pure module's block tree
// (parseAnswerMarkdown — the code fences split as before, then line by line, so no two of the model's lines or rows
// ever merge). Every child is TEXT: nothing the model writes is injected as HTML or fetched. Code blocks, bullets,
// paragraphs, bold and inline code keep today's markup; tables, headings, rules, quotes, italics, numbered items (the
// model's own number) and nested bullets are new. A table fills the bubble and its cells wrap between words; one that
// cannot fit without breaking a word scrolls sideways inside its own wrapper (D2 a — measured on every recorded table:
// 82 % fit at the ≈ 288 px bubble of a 1440-px screen, 0 words broken).
const TABLE_ALIGN = { left: "text-left", center: "text-center", right: "text-right" };
const HEADING_SIZE = { 1: "text-[1.1em]", 2: "text-[1.05em]", 3: "text-[1em]", 4: "text-[0.95em]", 5: "text-[0.95em]", 6: "text-[0.95em]" };
const INLINE_CODE_CLASS = "bg-white/10 px-1.5 py-0.5 rounded font-mono text-brand-soft text-xs";
const LIST_NUMBER_CLASS = "flex-none min-w-[1.4em] text-right text-white/55 tabular-nums";

function renderInline(tokens) {
  return tokens.map((t, i) => {
    if (t.t === "text") return t.text;
    if (t.t === "code") return <code key={i} className={INLINE_CODE_CLASS}>{t.text}</code>;
    if (t.t === "strong") return <strong key={i} className="font-bold text-white">{renderInline(t.children)}</strong>;
    return <em key={i} className="italic">{renderInline(t.children)}</em>;
  });
}

function renderQuoteLine(line, key) {
  if (line.t === "bullet") {
    return (
      <div key={key} className="flex gap-2">
        <span className="text-brand-vivid select-none">•</span>
        <div className="flex-1">{renderInline(line.tokens)}</div>
      </div>
    );
  }
  if (line.t === "ordered") {
    return (
      <div key={key} className="flex gap-1.5">
        <span className={LIST_NUMBER_CLASS}>{line.number}</span>
        <div className="flex-1">{renderInline(line.tokens)}</div>
      </div>
    );
  }
  if (line.tokens.length === 0) return <div key={key} className="h-2" />;
  return <p key={key} className={line.t === "heading" ? "font-bold text-white leading-relaxed" : "leading-relaxed"}>{renderInline(line.tokens)}</p>;
}

function renderTableCell(Tag, cell, align, key) {
  const head = Tag === "th";
  return (
    <Tag
      key={key}
      scope={head ? "col" : undefined}
      className={`px-[0.45em] py-[0.35em] ${head ? "align-bottom font-bold text-white bg-white/5 border-b border-white/15" : "align-top border-t border-white/5"} ${TABLE_ALIGN[align] || "text-left"}`}
    >
      <div className="min-w-[4ch] break-words">{cell ? renderInline(cell.tokens) : null}</div>
    </Tag>
  );
}

function renderAnswerBlocks(blocks) {
  const out = [];
  const firstShown = blocks.findIndex((b) => b.t !== "blank");
  for (let index = 0; index < blocks.length; index++) {
    const b = blocks[index];
    if (b.t === "codeblock") {
      const { language, text: code } = b;
      out.push(
        <div key={index} className="my-3 rounded-xl border border-white/10 bg-black/60 overflow-hidden font-mono text-xs w-full">
          {language && (
            <div className="bg-white/5 px-4 py-1.5 text-[10px] uppercase font-bold tracking-wider text-neutrals-medium border-b border-white/5 flex justify-between items-center select-none">
              <span>{language}</span>
            </div>
          )}
          <pre className="p-4 overflow-x-auto whitespace-pre custom-scrollbar text-brand-soft leading-relaxed">
            <code>{code}</code>
          </pre>
        </div>
      );
    } else if (b.t === "blank") {
      out.push(<div key={index} className="h-2" />);
    } else if (b.t === "para") {
      out.push(
        <p key={index} className="text-neutrals-light mb-1.5 leading-relaxed" style={b.depth ? { paddingLeft: `${b.depth}rem` } : undefined}>
          {renderInline(b.tokens)}
        </p>
      );
    } else if (b.t === "bullet") {
      out.push(
        <div key={index} className="flex gap-2 pl-4 py-0.5 text-neutrals-light" style={b.depth ? { paddingLeft: `${1 + b.depth}rem` } : undefined}>
          <span className="text-brand-vivid select-none">•</span>
          <div className="flex-1">{renderInline(b.tokens)}</div>
        </div>
      );
    } else if (b.t === "ordered") {
      out.push(
        <div key={index} className="flex gap-1.5 py-0.5 text-neutrals-light" style={b.depth ? { paddingLeft: `${b.depth}rem` } : undefined}>
          <span className={LIST_NUMBER_CLASS}>{b.number}</span>
          <div className="flex-1">{renderInline(b.tokens)}</div>
        </div>
      );
    } else if (b.t === "heading") {
      const Tag = `h${b.level}`;
      out.push(
        <Tag key={index} className={`${HEADING_SIZE[b.level]} font-bold text-white leading-snug mb-[0.35em] ${index === firstShown ? "mt-0" : "mt-[0.9em]"}`}>
          {renderInline(b.tokens)}
        </Tag>
      );
    } else if (b.t === "hr") {
      out.push(<hr key={index} className="border-0 border-t border-white/10 my-3" />);
    } else if (b.t === "quote") {
      // Consecutive quote lines share one bar.
      const lines = [];
      while (index < blocks.length && blocks[index].t === "quote") lines.push(blocks[index++].inner);
      index--;
      out.push(
        <blockquote key={index} className="border-l-2 border-white/20 pl-3 my-1 text-white/70 space-y-0.5">
          {lines.map((line, i) => renderQuoteLine(line, i))}
        </blockquote>
      );
    } else if (b.t === "table") {
      out.push(
        <div key={index} className="my-2 overflow-x-auto rounded-lg border border-white/10 custom-scrollbar">
          <table className="w-full border-collapse text-[13px] leading-[1.35]">
            <thead>
              <tr>{Array.from({ length: b.width }, (_, c) => renderTableCell("th", b.header[c], b.align[c], c))}</tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>{Array.from({ length: b.width }, (_, c) => renderTableCell("td", row[c], b.align[c], c))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }
  return out;
}

// T43 (design D2 a, D4 a; F-179): the turn's time and tokens under the answer —
// `55.2 s · retrieval 14.6 s · model 40.5 s · 4,968 → 3,087 tokens · qwen3.8:27b`
// — from the response's `timing` through the ONE formatter the harness's
// renderer shares (acceptance 3). The stage split, the clock times and the
// page's own end-to-end time (the network) are in the tooltip. A deadline-
// stopped rerank stage reads `retrieval 60.0 s (deadline)`, a failed one
// `retrieval failed (CODE)`, an estimated usage `≈ … (estimated)`, a turn
// with no answer the wall alone. Every number comes from `timing`; nothing is
// computed here (the T10 / T36 rule: a local computation is a second source
// of truth).
// T49 (t49-design.md §12b, D10–D12 — the owner's ask): the line's values as
// six labelled, colour-coded pills in the router / scope chip style —
// `TOTAL RESPONSE TIME 54.7 s · RETRIEVAL 11.6 s · THINKING 43.0 s · INPUT
// TOKENS 3,947 · OUTPUT TOKENS 3,026 · LLM qwen3.8:27b` — from the SAME
// formatter's `pills` (every value a substring of the `line` the harness's
// renderer and every record keep; U-TIMING pins it). A pill whose stage
// carries a state (a deadline-stopped rerank, a failed retrieval, an
// estimated usage) turns amber and says so inside the pill; a turn with no
// answer shows the total pill alone (T43's rule). The row's tooltip is T43's
// exact split, verbatim — "model" beside the pill's "thinking".
const PILL_HUES = {
  wall: "bg-white/10 text-white border-white/20",
  retrieval: "bg-sky-500/15 text-sky-300 border-sky-500/20",
  model: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/20",
  in: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20",
  out: "bg-lime-500/15 text-lime-300 border-lime-500/20",
  llm: "bg-indigo-500/15 text-indigo-300 border-indigo-500/20",
};
const PILL_STATE_HUE = "bg-amber-500/15 text-amber-400 border-amber-500/20";
// T48 (t48-design §2.5, D5): the grounded body, then the section in its own block — the pill says what it is before a
// word of it is read. The body's closing rule ("---", written before the heading) is not repeated above the block.
// T52 (t52-design §1, D2 a, D4 a; F-208): a next-step offer the model closed the section with (sectionOffer — the
// measured grammar, the closing sentence only, never emptying the box) is the assistant's next step about the documents,
// not outside knowledge: it renders below the box in the body's style, as the answer's closing line. Without one the
// box holds the section's content byte for byte, as before; the audit reads the answer as before (D3 a).
function AnswerWithSection({ text, format }) {
  const split = splitAnswer(text);
  if (split.section === null) return format(text);
  const body = split.body.replace(/\n[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*\s*$/, "").trimEnd();
  const { judgement, offer } = sectionOffer(split.content);
  return (
    <>
      {format(body)}
      <div data-beyond-the-documents="" className="mt-3 p-3 rounded-xl border border-amber-500/25 bg-amber-500/5 space-y-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/20">
            <RiErrorWarningLine size={10} />
            Beyond the documents · not from your documents
          </span>
        </div>
        {format(judgement)}
      </div>
      {offer !== null && (
        <div data-section-offer="" className="mt-3">
          {format(offer)}
        </div>
      )}
    </>
  );
}

function TurnTimingFooter({ timing, clientMs }) {
  const formatted = formatTurnTiming(timing, { clientMs });
  if (!formatted) return null;
  return (
    <div className="mt-2 pt-1.5 border-t border-white/5 flex items-center gap-1.5 flex-wrap" title={formatted.title}>
      {formatted.pills.map((pill) => (
        <span
          key={pill.id}
          data-turn-timing={pill.id}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider border ${pill.state ? PILL_STATE_HUE : PILL_HUES[pill.id] || PILL_HUES.wall}`}
        >
          <span className="uppercase opacity-60">{pill.label}</span>
          <span>{pill.text}</span>
        </span>
      ))}
    </div>
  );
}

export default function ChatPanel({
  chatHistory,
  chatInput,
  setChatInput,
  isAnalyzing,
  statusMessage,
  progress,
  handleGenerateQuery,
  onApplyFileOperation,
  // T15 (design D11): the document scope selector — the store's documents
  // and the one selected ("" = all documents), owned by the page.
  storeDocuments = [],
  documentScopeSelection = "",
  setDocumentScopeSelection = null,
  // Machinery PR 1 (design §4; D6, D7): the streaming code turn's live state and the per-turn thinking switch.
  liveTurn = null,
  thinkingMode = "on",
  setThinkingMode = null,
}) {
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);
  const [appliedOps, setAppliedOps] = useState(new Set());
  // T49 (design §2.2–2.4, D1 a, D5, D6; F-178): the hovered chip's page
  // render (mounted only while hovered — nothing is fetched until the pointer
  // arrives) and the open lightbox (with the chip that opened it, for the
  // focus return). The chips row scrolls inside the log, so the popover is
  // `fixed` from the chip's rect and cleared on the log's scroll.
  const [hoverPreview, setHoverPreview] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const lightboxCloseRef = useRef(null);
  const closeLightbox = () => {
    const opener = lightbox ? lightbox.opener : null;
    setLightbox(null);
    if (opener && typeof opener.focus === "function") opener.focus();
  };
  useEffect(() => {
    if (!lightbox) return undefined;
    const onKey = (e) => { if (e.key === "Escape") closeLightbox(); };
    window.addEventListener("keydown", onKey);
    lightboxCloseRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);
  // 8 px above the chip, or below it when the chip sits within 260 px of the
  // viewport's top (a portrait page needs the room); kept inside the width.
  const placePreview = (rect) => {
    const above = rect.top >= 260;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 336));
    return { left, top: above ? rect.top - 8 : rect.bottom + 8, above };
  };
  const showPreview = (e, preview, marker) => setHoverPreview({ preview, marker, place: placePreview(e.currentTarget.getBoundingClientRect()), failed: false });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  /**
   * An answer's markdown as elements — T55 (F-217): the pure module's block tree (code fences, headings, tables,
   * rules, quotes, bullets, numbered items, paragraphs; bold, italics, inline code) through renderAnswerBlocks, text
   * nodes only. Shared with T48's "Beyond the documents" box and T52's offer (AnswerWithSection formats each part).
   */
  const formatMessageContent = (text) => {
    if (!text) return null;
    return renderAnswerBlocks(parseAnswerMarkdown(text).blocks);
  };

  return (
    <div className="bg-[#121212] border border-white/10 rounded-3xl p-5 flex flex-col justify-between shadow-2xl relative flex-1 min-h-0 w-full text-white">
      <div className="border-b border-white/5 pb-3 mb-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <RiRobot2Line size={18} className="text-brand-vivid" />
          <span className="text-sm font-sans font-bold uppercase tracking-widest text-neutrals-light">
            NexCODE - The Nexus Coding Assistant
          </span>
        </div>
      </div>

      {/* Chat Logs Window */}
      <div className="flex-1 overflow-y-auto mb-4 space-y-4 pr-2 custom-scrollbar" onScroll={() => setHoverPreview(null)}>
        {chatHistory.map((chat, idx) => (
          <div
            key={idx}
            className={`flex flex-col max-w-[85%] ${chat.sender === "user" ? "ml-auto items-end" : "mr-auto items-start"}`}
          >
            <div
              className={`p-3.5 rounded-2xl text-sm md:text-base shadow-lg w-full ${
                chat.sender === "user"
                  ? "bg-brand-vivid text-white rounded-br-none"
                  : chat.isFailure
                    ? "bg-red-500/5 border border-red-500/25 text-neutrals-light rounded-bl-none"
                    : chat.retrievalError || chat.retrieval?.state === "degraded" || chat.generation?.cut
                      ? "bg-amber-500/5 border border-amber-500/25 text-neutrals-light rounded-bl-none"
                      : "bg-white/3 border border-white/5 text-neutrals-light rounded-bl-none"
              }`}
            >
              {chat.sender === "user" ? (
                <p className="leading-relaxed whitespace-pre-wrap">{chat.text}</p>
              ) : (
                <div className="space-y-1">
                  {/* T12: an answer produced without retrieved context is
                      visibly marked, so "the documents don't mention it" can
                      never be mistaken for a grounded answer. */}
                  {chat.retrievalError && (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/20">
                        <RiErrorWarningLine size={10} />
                        Retrieval failed: {chat.retrievalError.code}
                      </span>
                      <span className="text-[10px] text-neutrals-medium">answer is not grounded in your documents</span>
                    </div>
                  )}
                  {chat.isFailure && !chat.retrievalError && (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-red-500/15 text-red-400 border border-red-500/20">
                        <RiErrorWarningLine size={10} />
                        No answer generated
                      </span>
                    </div>
                  )}
                  {/* T10/F-34: retrieval degradation, disclosed to the person
                      reading the answer. Everyone else already knew — the
                      model gets a prompt banner, the trace drawer an amber
                      badge, API consumers `retrieval.state` — while this
                      component rendered a never-relevance-ranked turn exactly
                      like a healthy one. T10 lets unscored passages pass the
                      relevance floor; this chip is the condition the owner
                      attached to that ruling, so it is load-bearing, not
                      decorative. Gated on the TYPED state, and worded per
                      code: claiming "not relevance-ranked" when 7 of 8
                      passages were properly ranked would be its own small
                      dishonesty, and over-warning teaches people to ignore
                      the warning. */}
                  {chat.retrieval?.state === "degraded" && (
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span
                        title={chat.retrieval.message || ""}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/20"
                      >
                        <RiErrorWarningLine size={10} />
                        {chat.retrieval.code === "RERANK_PARTIAL"
                          ? "Some sources not relevance-checked"
                          : chat.retrieval.code === "RERANK_DOWN"
                            ? "Sources not relevance-ranked"
                            : "Retrieval degraded"}
                        {chat.retrieval.code ? ` · ${chat.retrieval.code}` : ""}
                      </span>
                      {/* A plain-language consequence, but only for codes
                          whose consequence is known. An unrecognised future
                          code still gets the chip and its own message as a
                          tooltip — it does not get an invented summary. */}
                      {chat.retrieval.code === "RERANK_PARTIAL" ? (
                        <span className="text-[10px] text-neutrals-medium">
                          unchecked passages are listed last and may be irrelevant
                        </span>
                      ) : chat.retrieval.code === "RERANK_DOWN" ? (
                        <span className="text-[10px] text-neutrals-medium">
                          order is meaningless and passages may be irrelevant
                        </span>
                      ) : chat.retrieval.code === "EMBED_MODEL_MISMATCH" ? (
                        <span className="text-[10px] text-neutrals-medium">
                          the vector search used a different model from the one that indexed the collection; relevant passages may be missing
                        </span>
                      ) : null}
                    </div>
                  )}
                  {/* T36 (design D1 / D2; F-134): a cut answer, disclosed to
                      the person reading it — the T10 / F-34 pattern beside
                      the retrieval chip. The provider stopped the answer at
                      the output budget and some answer exists (GENERATION_CUT,
                      a degradation on a 200); the sentence and its numbers
                      come from the typed field, never re-derived here. An
                      EMPTY cut is a failure (GENERATION_EMPTY) and renders as
                      T12's red "No answer generated" chip with the error
                      text as the message — nothing new to draw. */}
                  {chat.generation?.cut && chat.generation.code === "GENERATION_CUT" && (
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span
                        title={`finish reason "${chat.generation.finishReason}"; model ${chat.generation.model}; output budget requested ${chat.generation.budget?.requested} → applied ${chat.generation.budget?.applied} (${chat.generation.budget?.rule} floor ${chat.generation.budget?.floor}); ${chat.generation.thinking?.reasoningChars} characters of hidden reasoning, ${chat.generation.thinking?.answerChars} of answer`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/20"
                      >
                        <RiErrorWarningLine size={10} />
                        Answer cut short · {chat.generation.code}
                      </span>
                      <span className="text-[10px] text-neutrals-medium">{chat.generation.message}</span>
                    </div>
                  )}
                  {/* T15 (design D13): the router's verdict on every answer —
                      mode and intent — and the scope the turn was limited to
                      (design D4 / D11: selected, named or voted). */}
                  {(chat.router || (chat.documentScope && chat.documentScope.documents && chat.documentScope.documents.length > 0)) && (
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      {chat.router && (
                        <span
                          title={`mode ${chat.router.mode} (${chat.router.modeSource}); intent ${chat.router.intent}${chat.router.model && chat.router.model.model ? `; model ${chat.router.model.model}` : ""}${chat.router.followUp && chat.router.followUp.applied ? `; follow-up (${chat.router.followUp.reason}) — retrieved with the previous question` : ""}`}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider border ${
                            chat.router.mode === "doc" ? "bg-blue-500/15 text-blue-300 border-blue-500/20" : chat.router.mode === "code" ? "bg-brand-vivid/15 text-brand-vivid border-brand-vivid/20" : "bg-teal-500/15 text-teal-300 border-teal-500/20"
                          }`}
                        >
                          {chat.router.mode}{chat.router.mode !== "chat" ? ` · ${chat.router.intent}` : ""}{chat.router.followUp && chat.router.followUp.applied ? " · follow-up" : ""}
                        </span>
                      )}
                      {chat.documentScope && chat.documentScope.documents && chat.documentScope.documents.length > 0 && (
                        <span
                          title={chat.documentScope.reason || ""}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider bg-purple-500/15 text-purple-300 border border-purple-500/20"
                        >
                          scope: {chat.documentScope.documents.map((d) => d.source).join(", ")}
                          {chat.documentScope.method === "request" ? " · selected" : chat.documentScope.method === "named" ? " · named" : chat.documentScope.method === "vote" ? " · by vote" : ""}
                          {/* T63 (t63-design.md D9 (a)): the answer was read from the entire document — a lookup on the
                              selected document, or an enumeration read whole. */}
                          {chat.documentScope.coverage === "complete" ? " · whole document" : ""}
                          {chat.documentScope.excludedForeign > 0 ? ` · ${chat.documentScope.excludedForeign} other-document passage(s) left out` : ""}
                        </span>
                      )}
                    </div>
                  )}
                  {/* T65 (t65-design.md D5 (a)): a vote that other documents nearly matched, with no name in the question
                      to settle it — the answer is the vote's document, and this line says which others matched and how
                      to ask about them. Computed from the ranked scores; never part of the model's prompt. */}
                  {/* Machinery PR 1 (design §4, D7): how a code turn ran — thinking mode, layers, unverified markers. */}
                  {chat.coding && <CodingTurnChips coding={chat.coding} />}
                  {chat.documentScope && chat.documentScope.method === "vote" && Array.isArray(chat.documentScope.contested) && chat.documentScope.contested.length > 0 && (
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span
                        title={chat.documentScope.contested.map((c) => `${c.source}: best passage ${c.best} against ${c.winnerBest}`).join("; ")}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/20"
                      >
                        <RiErrorWarningLine size={10} />
                        Chosen by vote
                      </span>
                      <span className="text-[10px] text-neutrals-medium">
                        Your question names no document, and {chat.documentScope.contested.map((c) => c.source).join(" and ")} matched nearly as strongly. Name one, or select it, to ask about it.
                      </span>
                    </div>
                  )}
                  {/* Intent badge for IDE Bridge messages */}
                  {chat.intent && !chat.router && (
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-brand-vivid/15 text-brand-vivid border border-brand-vivid/20">
                        <RiCodeLine size={10} />
                        {chat.intent.replace("code-", "").replace("file-", "")}
                      </span>
                      {chat.bridgeConnected !== undefined && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider ${
                          chat.bridgeConnected
                            ? "bg-green-500/15 text-green-400 border border-green-500/20"
                            : "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20"
                        }`}>
                          {chat.bridgeConnected ? "Bridge Connected" : "Bridge Offline"}
                        </span>
                      )}
                      {chat.ideContext?.activeFile && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider bg-white/5 text-neutrals-medium border border-white/10">
                          📄 {chat.ideContext.activeFile.path}
                        </span>
                      )}
                    </div>
                  )}
                  {/* T48 (t48-design §2.5, D5): a "Beyond the documents" section the response reports is split off by the
                      pure module's one reader (splitAnswer — the audit's own) and shown below the grounded body in its
                      own bordered block under T12's amber pill: the model's own knowledge, labelled as not from the
                      documents. No section, no change — the answer renders exactly as before. */}
                  {chat.answerPolicy && chat.answerPolicy.section && chat.answerPolicy.section.present ? (
                    <AnswerWithSection text={chat.text} format={formatMessageContent} />
                  ) : (
                    formatMessageContent(chat.text)
                  )}
                  {/* File operation "Apply Changes" buttons */}
                  {chat.fileOperations && chat.fileOperations.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                      <p className="text-[11px] font-mono uppercase tracking-wider text-neutrals-medium font-bold">Pending File Operations</p>
                      {chat.fileOperations.map((op, opIdx) => {
                        // Keyed by the turn and the file, never by the message's place in the chat: Select demo clears
                        // the chat, so a re-run's answers reuse the places of the last run's, and a place-keyed Apply
                        // showed the new proposal as already applied (S1 after S2, 2026-10-10).
                        const opKey = `${(chat.coding && chat.coding.turnId) || `message-${idx}`}:${op.path || opIdx}`;
                        const isApplied = appliedOps.has(opKey);
                        return (
                          <div key={opIdx} className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl px-3 py-2">
                            <RiFileAddLine size={14} className="text-brand-vivid flex-shrink-0" />
                            <span className="text-xs font-mono text-neutrals-light flex-1 truncate">{op.path}</span>
                            <button
                              onClick={async () => {
                                if (onApplyFileOperation && !isApplied) {
                                  await onApplyFileOperation(op);
                                  setAppliedOps(prev => new Set([...prev, opKey]));
                                }
                              }}
                              disabled={isApplied}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                isApplied
                                  ? "bg-green-500/20 text-green-400 border border-green-500/20"
                                  : "bg-brand-vivid/20 text-brand-vivid border border-brand-vivid/30 hover:bg-brand-vivid/30 active:scale-95"
                              }`}
                            >
                              {isApplied ? <><RiCheckLine size={12} /> Applied</> : "Apply Changes"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* T14: citation chips — the sources the answer actually
                      cited, plus an amber warning when the citation audit
                      found page claims matching no retrieved chunk. */}
                  {((chat.citations && chat.citations.length > 0) || (chat.uncitedClaims && chat.uncitedClaims.length > 0)) && (
                    <div className="mt-3 pt-2 border-t border-white/5 flex items-center gap-1.5 flex-wrap">
                      {(chat.citations || []).map((cite, cIdx) => {
                        // T49 (design §2.2, D1 a, D2 a; F-178, F-184): a chip whose citation carries a page render
                        // (`imagePath` under the crops route) is a button — the same text plus a 10 px image glyph —
                        // that previews the page on hover / focus and opens it in the lightbox on click. A chip
                        // without one is the <span> below, byte for byte: the same class string, the same children
                        // (the shared fragment adds no DOM; U-FAIL/T49 pins both). The chip's TEXT never changes
                        // (the owner's rule): a ranked figure and a text chunk are told apart by the glyph alone.
                        const preview = previewFor(cite);
                        const chipBody = (
                          <>
                            [{cite.marker}] {cite.source}
                            {/* T34 (design D5, D7): a slide deck's page is its slide; an unpaginated file's location is its
                                section — the innermost heading shown, the full path in the tooltip. */}
                            {cite.page != null
                              ? ` · ${cite.locationKind === "slide" ? "slide" : "p."}${cite.locationKind === "slide" ? " " : ""}${cite.page}`
                              : cite.sectionPath
                                ? <span title={cite.sectionPath}>{` · §${String(cite.sectionPath).split(" › ").pop()}`}</span>
                                : ""}
                            {/* T28: a block that arrived by page adjacency, not ranking (design D6). */}
                            {cite.companionKind === "caption" ? " · figure" : cite.companionKind === "text" ? " · page text" : ""}
                          </>
                        );
                        if (!preview) {
                          return (
                            <span key={cite.marker || cIdx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider bg-white/5 text-neutrals-medium border border-white/10">
                              {chipBody}
                            </span>
                          );
                        }
                        return (
                          <button
                            key={cite.marker || cIdx}
                            type="button"
                            title="Show the cited figure"
                            aria-haspopup="dialog"
                            data-figure-chip={preview.src}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider bg-white/5 text-neutrals-medium border border-white/10 cursor-pointer hover:border-brand-vivid/50 hover:text-neutrals-light focus-visible:border-brand-vivid"
                            onMouseEnter={(e) => showPreview(e, preview, cite.marker)}
                            onFocus={(e) => showPreview(e, preview, cite.marker)}
                            onMouseLeave={() => setHoverPreview(null)}
                            onBlur={() => setHoverPreview(null)}
                            onClick={(e) => { setHoverPreview(null); setLightbox({ preview, marker: cite.marker, opener: e.currentTarget, failed: false }); }}
                          >
                            {chipBody}
                            <RiImageLine size={10} aria-hidden="true" />
                          </button>
                        );
                      })}
                      {chat.uncitedClaims && chat.uncitedClaims.length > 0 && (
                        <span
                          title={chat.uncitedClaims.join("\n")}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/20"
                        >
                          <RiErrorWarningLine size={10} />
                          {chat.uncitedClaims.length} uncited page claim(s)
                        </span>
                      )}
                    </div>
                  )}
                  {/* T43 (design D2 a): the turn's time and tokens, under the chips. */}
                  {chat.timing && <TurnTimingFooter timing={chat.timing} clientMs={chat.clientMs} />}
                </div>
              )}
            </div>
            <span className="text-[10px] text-neutrals-medium mt-1 font-mono" suppressHydrationWarning>
              {chat.timestamp}
            </span>
          </div>
        ))}

        {/* Machinery PR 1 (design §4, D6): a streaming code turn shows its live bubble — the layers searched, the
            reasoning count, the answer as it arrives — instead of the timer-driven bar. */}
        {isAnalyzing && liveTurn && <CodingLiveTurn liveTurn={liveTurn} />}
        {/* In-progress progress indicators (ANALYSING, SCANNING, GENERATING) */}
        {isAnalyzing && !liveTurn && (
          <div className="flex flex-col gap-2 w-full max-w-[80%] bg-white/2 border border-white/5 rounded-2xl p-4 rounded-bl-none">
            <div className="flex items-center gap-2.5 text-sm text-brand-vivid font-bold tracking-wider">
              <RiLoader4Line size={14} className="animate-spin" />
              <span>{statusMessage}...</span>
            </div>
            <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden">
              <div
                className="bg-brand-vivid h-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Prompt Entry Box */}
      <form onSubmit={handleGenerateQuery} className="relative mt-auto flex flex-col gap-2.5">
        {/* T15 (design D11): the document scope for /doc turns — "All
            documents" or one of the store's documents; sent as
            documentScope on the request. Previewing a document in the
            Standards Drawer sets it. */}
        {typeof setDocumentScopeSelection === "function" && storeDocuments.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium whitespace-nowrap">Document scope</label>
            <select
              value={documentScopeSelection}
              onChange={(e) => setDocumentScopeSelection(e.target.value)}
              disabled={isAnalyzing}
              className="flex-1 min-w-0 py-1 px-2 rounded-lg border border-white/10 bg-black/40 text-[11px] text-white outline-none focus:border-brand-vivid font-sans truncate"
              title="Limit a /doc question to one document; the answer's scope chip says which document was used"
            >
              <option value="">All documents ({storeDocuments.length}) — chosen by the question</option>
              {storeDocuments.map((d) => (
                <option key={d.source} value={d.source}>
                  {d.source} ({d.totalPages} p, {d.chunkCount} chunks)
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="relative w-full">
          <textarea
            ref={textareaRef}
            rows={3}
            placeholder={"Ask NexCODE (Shift+Enter for a new line)\nUse '/chat' for chat, '/code' for code, '/doc' for document"}
            value={chatInput}
            onChange={(e) => {
              setChatInput(e.target.value);
              // Auto-grow: reset then set to scrollHeight
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 240) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleGenerateQuery(e);
                // Reset height after submit
                e.target.style.height = "auto";
              }
            }}
            disabled={isAnalyzing}
            className="w-full bg-black/60 border border-white/10 rounded-2xl py-3 pl-4 pr-12 text-sm md:text-base text-white outline-none focus:border-brand-vivid transition-all placeholder:text-neutrals-medium font-sans resize-none custom-scrollbar min-h-16 max-h-60 overflow-auto"
            suppressHydrationWarning
          />
          <button
            type="submit"
            disabled={isAnalyzing}
            className="absolute right-3 bottom-3.5 w-8 h-8 rounded-xl bg-brand-vivid text-white flex items-center justify-center hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
          >
            <RiSendPlaneFill size={16} />
          </button>
        </div>

        {/* System Call Command Quick Chips */}
        <div className="flex items-center gap-1.5 px-1 text-[11px] font-sans">
          {/* Machinery PR 1 (D7): thinking on by default; off sends the next code turn through Ollama's own request form. */}
          {typeof setThinkingMode === "function" && (
            <button
              type="button"
              onClick={() => setThinkingMode((m) => (m === "off" ? "on" : "off"))}
              disabled={isAnalyzing}
              title="Thinking for the next code turn: on is slower and more careful, off is faster. Recorded on every turn."
              className={`mr-2 px-2 py-0.5 rounded-md border font-mono text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-40 ${thinkingMode === "off" ? "bg-white/5 border-white/10 text-neutral-400" : "bg-brand-vivid/15 border-brand-vivid/30 text-brand-vivid"}`}
            >
              thinking {thinkingMode}
            </button>
          )}
          <span className="font-mono font-bold text-neutral-400 uppercase tracking-wider text-[10px]">Prefix Commands:</span>
          <button
            type="button"
            onClick={() => setChatInput(prev => prev.startsWith("/chat ") ? prev : `/chat ${prev}`)}
            className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 hover:border-purple-500/50 hover:bg-purple-500/20 hover:text-purple-300 transition-all text-neutral-300 font-mono text-[11px] font-semibold cursor-pointer"
          >
            /chat
          </button>
          <button
            type="button"
            onClick={() => setChatInput(prev => prev.startsWith("/code ") ? prev : `/code ${prev}`)}
            className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 hover:border-purple-500/50 hover:bg-purple-500/20 hover:text-purple-300 transition-all text-neutral-300 font-mono text-[11px] font-semibold cursor-pointer"
          >
            /code
          </button>
          <button
            type="button"
            onClick={() => setChatInput(prev => prev.startsWith("/doc ") ? prev : `/doc ${prev}`)}
            className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 hover:border-purple-500/50 hover:bg-purple-500/20 hover:text-purple-300 transition-all text-neutral-300 font-mono text-[11px] font-semibold cursor-pointer"
          >
            /doc
          </button>
        </div>

        {/* E5 (Enablers PR, 2026-10-06, the owner's unlock): the "Saved code tasks" dropdown is gone — its five canned
            prompts named files removed from the demo on 2026-10-06; the scenario panel (brief v0.2 M2) replaces it. */}
      </form>

      {/* T49 (design §2.3, D1 a, D5): the hovered chip's page render — fixed from the chip's rect (the chips row
          scrolls inside the log; an absolute popover would clip at its edge), mounted only while hovered so an
          answer with nine cited pages fetches nothing until pointed at, cleared on the log's scroll; a failed load
          says so in words. The file is the bridge's whole-page render (design §0c), fitted for a portrait page. */}
      {hoverPreview && (
        <div
          className="fixed z-[55] pointer-events-none max-w-[20rem] flex flex-col items-start gap-1"
          style={hoverPreview.place.above ? { left: hoverPreview.place.left, top: hoverPreview.place.top, transform: "translateY(-100%)" } : { left: hoverPreview.place.left, top: hoverPreview.place.top }}
          data-figure-preview={hoverPreview.preview.src}
        >
          {hoverPreview.failed ? (
            <span className="px-2 py-1 rounded-lg bg-[#141414] border border-amber-500/40 text-[10px] font-mono text-amber-400">crop not available</span>
          ) : (
            <img
              src={hoverPreview.preview.src}
              alt={hoverPreview.preview.alt}
              loading="eager"
              className="max-h-60 max-w-[20rem] object-contain rounded-lg border border-white/15 bg-white shadow-2xl"
              onError={() => setHoverPreview((h) => (h ? { ...h, failed: true } : h))}
            />
          )}
          <span className="max-w-[20rem] truncate px-1.5 py-0.5 rounded-md bg-black/80 text-[10px] font-mono tracking-wider text-neutrals-light">
            {hoverPreview.preview.caption}
          </span>
        </div>
      )}

      {/* T49 (design §2.4, D1 a, D3 a, D6): the cited page in a lightbox — a fixed overlay rendered by the panel
          (no portal: the ancestors carry no transform / filter; the StandardsDrawer precedent), role=dialog,
          Escape, click-outside, a close button, focus back to the chip on close. The caption is the stored title
          carried on the citation (the figure's name on a whole-page render), then the chip's source · page. A
          failed load is disclosed with the path, never a broken icon (T12's rule for the UI). */}
      {lightbox && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6" onClick={closeLightbox}>
          <figure
            role="dialog"
            aria-modal="true"
            aria-label={lightbox.preview.caption}
            className="relative flex flex-col items-center gap-3 max-w-[92vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              ref={lightboxCloseRef}
              type="button"
              aria-label="Close"
              title="Close (Esc)"
              onClick={closeLightbox}
              className="absolute -top-3 -right-3 z-10 p-1.5 rounded-full bg-[#141414] border border-white/20 text-neutrals-light hover:text-white hover:border-brand-vivid/60 focus-visible:border-brand-vivid cursor-pointer"
            >
              <RiCloseLine size={16} />
            </button>
            {lightbox.failed ? (
              <p className="max-w-xl px-4 py-3 rounded-xl bg-[#141414] border border-amber-500/40 text-xs font-mono text-amber-400 break-all">
                The crop could not be loaded: {lightbox.preview.src} — the crops route answered an error; see the container log.
              </p>
            ) : (
              <img
                src={lightbox.preview.src}
                alt={lightbox.preview.alt}
                className="max-w-[92vw] max-h-[82vh] object-contain rounded-lg bg-white"
                onError={() => setLightbox((l) => (l ? { ...l, failed: true } : l))}
              />
            )}
            <figcaption className="flex flex-col items-center gap-0.5 text-center">
              <span className="text-[10px] font-mono tracking-wider text-neutrals-light">[{lightbox.marker}] · {lightbox.preview.caption}</span>
              <span className="text-[10px] font-mono text-neutrals-medium break-all">{lightbox.preview.src}</span>
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}
