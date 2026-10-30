"use client";

/**
 * MarkdownBlocks — the block tree of the frozen `parseAnswerMarkdown` mapped to presentation-size elements (presenter
 * panels design §6, 2026-10-07). Used by the Demo panel's document viewer for Markdown and text documents, and by the
 * Output panel (PR B) for an answer and a record. Every child is text: nothing the model or a document wrote is ever
 * injected as HTML. The chat panel keeps its own, pinned renderer; this one is sized for a room.
 */
import React from "react";
import { parseAnswerMarkdown } from "@/lib/rag/answer_markdown";

const HEADING = { 1: "text-2xl", 2: "text-xl", 3: "text-lg", 4: "text-base", 5: "text-[15px]", 6: "text-[15px]" };
const INLINE_CODE = "font-mono text-[0.9em] bg-white/10 border border-white/10 rounded px-1 py-px text-neutrals-light";

function renderInline(tokens) {
  return (Array.isArray(tokens) ? tokens : []).map((t, i) => {
    if (t.t === "text") return t.text;
    if (t.t === "code") return <code key={i} className={INLINE_CODE}>{t.text}</code>;
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
      <div key={key} className="flex gap-2">
        <span className="font-mono text-neutrals-medium">{line.number}</span>
        <div className="flex-1">{renderInline(line.tokens)}</div>
      </div>
    );
  }
  if (line.t === "heading") return <div key={key} className="font-bold text-white">{renderInline(line.tokens)}</div>;
  return <div key={key}>{renderInline(line.tokens)}</div>;
}

function renderCell(Tag, cell, align, key) {
  const style = align ? { textAlign: align } : undefined;
  return (
    <Tag key={key} style={style} className={`px-3 py-2 border-b border-white/10 align-top ${Tag === "th" ? "bg-white/5 text-white font-semibold text-left" : "text-neutrals-light"}`}>
      {cell ? renderInline(cell.tokens) : ""}
    </Tag>
  );
}

function renderBlocks(blocks) {
  const out = [];
  let index = 0;
  while (index < blocks.length) {
    const b = blocks[index];
    if (b.t === "blank") {
      out.push(<div key={index} className="h-2" />);
    } else if (b.t === "codeblock") {
      out.push(
        <div key={index} className="my-3 rounded-xl border border-white/10 overflow-hidden bg-black/60">
          {b.language && <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-neutrals-medium border-b border-white/10 bg-white/5">{b.language}</div>}
          <pre className="px-4 py-3 text-[13px] font-mono leading-relaxed text-neutrals-light overflow-x-auto custom-scrollbar whitespace-pre">{b.text}</pre>
        </div>
      );
    } else if (b.t === "heading") {
      const Tag = `h${b.level}`;
      out.push(
        <Tag key={index} className={`${HEADING[b.level] || "text-base"} font-bold text-white leading-snug mb-2 ${index === 0 ? "mt-0" : "mt-5"}`}>
          {renderInline(b.tokens)}
        </Tag>
      );
    } else if (b.t === "hr") {
      out.push(<hr key={index} className="border-0 border-t border-white/10 my-4" />);
    } else if (b.t === "bullet") {
      out.push(
        <div key={index} className="flex gap-2 py-0.5" style={b.depth ? { paddingLeft: `${b.depth * 1.25}rem` } : undefined}>
          <span className="text-brand-vivid select-none">•</span>
          <div className="flex-1">{renderInline(b.tokens)}</div>
        </div>
      );
    } else if (b.t === "ordered") {
      out.push(
        <div key={index} className="flex gap-2 py-0.5" style={b.depth ? { paddingLeft: `${b.depth * 1.25}rem` } : undefined}>
          <span className="font-mono text-neutrals-medium">{b.number}</span>
          <div className="flex-1">{renderInline(b.tokens)}</div>
        </div>
      );
    } else if (b.t === "quote") {
      const lines = [];
      while (index < blocks.length && blocks[index].t === "quote") lines.push(blocks[index++].inner);
      index--;
      out.push(
        <blockquote key={index} className="border-l-2 border-brand-vivid/50 pl-4 my-2 text-white/80 space-y-1">
          {lines.map((line, i) => renderQuoteLine(line, i))}
        </blockquote>
      );
    } else if (b.t === "table") {
      out.push(
        <div key={index} className="my-3 overflow-x-auto rounded-xl border border-white/10 custom-scrollbar">
          <table className="w-full border-collapse text-[14px] leading-snug">
            <thead>
              <tr>{Array.from({ length: b.width }, (_, c) => renderCell("th", b.header[c], b.align[c], c))}</tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>{Array.from({ length: b.width }, (_, c) => renderCell("td", row[c], b.align[c], c))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else {
      out.push(
        <p key={index} className="my-1 leading-relaxed" style={b.depth ? { paddingLeft: `${b.depth * 1.25}rem` } : undefined}>
          {renderInline(b.tokens)}
        </p>
      );
    }
    index++;
  }
  return out;
}

export default function MarkdownBlocks({ text, className = "" }) {
  const { blocks } = parseAnswerMarkdown(typeof text === "string" ? text : "");
  return <div className={`text-[15px] text-neutrals-light font-sans ${className}`}>{renderBlocks(blocks)}</div>;
}
