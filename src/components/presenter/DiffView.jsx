"use client";

/**
 * DiffView — a demo's code change as unified diffs at presentation size (PR B; the owner's D1 (b) of 2026-10-07: the
 * code change is shown in the Results panel). Reads an evidence record's `changes.files` (src/lib/coding/diff.js's shape:
 * hunks of lines with old and new line numbers). Every line is text; nothing is injected as HTML.
 */
import React from "react";
import { RiCodeSSlashLine, RiMapPin2Line } from "@remixicon/react";

const CHIP = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider border";
const STATUS = {
  modified: "bg-amber-500/10 text-amber-300 border-amber-500/25",
  added: "bg-teal-500/10 text-teal-300 border-teal-500/25",
  deleted: "bg-red-500/10 text-red-300 border-red-500/25",
};

export default function DiffView({ files = [], onOpenInIde }) {
  if (!Array.isArray(files) || files.length === 0) {
    return <div className="text-sm font-sans text-neutrals-medium">No file was changed against the seed.</div>;
  }
  return (
    <div className="flex flex-col gap-5" data-diff-view="true">
      {files.map((fd) => (
        <section key={fd.path} className="rounded-2xl border border-white/10 overflow-hidden bg-black/30" data-diff-file={fd.path}>
          <header className="flex items-center gap-2 px-4 py-2.5 bg-white/5 border-b border-white/10 flex-wrap">
            <RiCodeSSlashLine size={14} className="text-teal-300" />
            <span className="text-sm font-mono text-white break-all">{fd.path}</span>
            <span className={`${CHIP} ${STATUS[fd.status] || STATUS.modified}`}>{fd.status}</span>
            {Number.isFinite(fd.added) && <span className="text-sm font-mono text-teal-300">+{fd.added}</span>}
            {Number.isFinite(fd.removed) && <span className="text-sm font-mono text-red-300">-{fd.removed}</span>}
            {typeof onOpenInIde === "function" && fd.status !== "deleted" && Array.isArray(fd.hunks) && fd.hunks.length > 0 && (
              <button
                type="button"
                onClick={() => onOpenInIde(fd)}
                className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-white/15 bg-white/5 text-[11px] font-sans font-semibold text-neutrals-light hover:border-brand-vivid/50 hover:text-white cursor-pointer"
                title="Open the file in the IDE at the first change"
              >
                <RiMapPin2Line size={12} /> Open in the IDE
              </button>
            )}
          </header>
          {fd.tooLarge ? (
            <div className="px-4 py-3 text-sm font-sans text-neutrals-medium">This file is too large to show line by line here: open it in the IDE.</div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full border-collapse font-mono text-[13px] leading-[1.5]">
                <tbody>
                  {fd.hunks.map((h, hi) => (
                    <React.Fragment key={hi}>
                      <tr>
                        <td colSpan={4} className="px-4 py-1 bg-blue-500/10 text-blue-300 text-[12px] select-none">
                          @@ -{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@
                        </td>
                      </tr>
                      {h.lines.map((l, li) => (
                        <tr key={li} className={l.type === "+" ? "bg-teal-500/10" : l.type === "-" ? "bg-red-500/10" : ""}>
                          <td className="w-12 px-2 text-right text-neutrals-dark select-none align-top">{l.oldNo ?? ""}</td>
                          <td className="w-12 px-2 text-right text-neutrals-dark select-none align-top">{l.newNo ?? ""}</td>
                          <td className={`w-5 text-center select-none align-top ${l.type === "+" ? "text-teal-300" : l.type === "-" ? "text-red-300" : "text-neutrals-dark"}`}>{l.type === " " ? "" : l.type}</td>
                          <td className={`pr-4 whitespace-pre ${l.type === "+" ? "text-teal-50" : l.type === "-" ? "text-red-100" : "text-neutrals-light"}`}>{l.text}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
