"use client";

/**
 * JsonView — any JSON output shown as readable sections and tables (PR B; the owner's ask of 2026-10-07: "if the output
 * is generated in an MD format file (and / or JSON) we need a tool / viewer that renders that into a human readable
 * format"). Keys become labels ("createdAt" reads "Created at"); a list of flat objects becomes a table; nesting is
 * indented, to a fixed depth. Every value is text; nothing is injected as HTML.
 */
import React from "react";

const MAX_DEPTH = 6;
const MAX_ROWS = 200;

function label(key) {
  const s = String(key)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : String(key);
}

const isPlain = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);

function Scalar({ value }) {
  if (value === null || value === undefined || value === "") return <span className="text-neutrals-medium">—</span>;
  if (typeof value === "boolean") return <span className={value ? "text-teal-300" : "text-neutrals-medium"}>{value ? "yes" : "no"}</span>;
  return <span className="text-neutrals-light whitespace-pre-wrap break-words">{String(value)}</span>;
}

export default function JsonView({ value, depth = 0 }) {
  if (isPlain(value) || value === undefined) return <Scalar value={value} />;
  if (depth >= MAX_DEPTH) return <span className="text-neutrals-medium">…</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-neutrals-medium">none</span>;
    if (value.every(isPlain)) {
      return (
        <ul className="list-disc pl-5 flex flex-col gap-0.5">
          {value.slice(0, MAX_ROWS).map((v, i) => (
            <li key={i}>
              <Scalar value={v} />
            </li>
          ))}
        </ul>
      );
    }
    const flat = value.every((v) => v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every(isPlain));
    if (flat) {
      const keys = [...new Set(value.flatMap((v) => Object.keys(v)))].slice(0, 10);
      return (
        <div className="overflow-x-auto custom-scrollbar rounded-xl border border-white/10">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {keys.map((k) => (
                  <th key={k} className="px-3 py-2 text-left bg-white/5 text-white font-semibold border-b border-white/10">
                    {label(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {value.slice(0, MAX_ROWS).map((row, i) => (
                <tr key={i}>
                  {keys.map((k) => (
                    <td key={k} className="px-3 py-1.5 border-b border-white/5 align-top">
                      <Scalar value={row[k]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return (
      <ol className="flex flex-col gap-2">
        {value.slice(0, MAX_ROWS).map((v, i) => (
          <li key={i} className="rounded-xl border border-white/10 px-3 py-2">
            <JsonView value={v} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  return (
    <dl className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-4 gap-y-1.5 text-[13px]">
      {Object.entries(value).map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-neutrals-medium font-sans">{label(k)}</dt>
          <dd className="min-w-0">
            <JsonView value={v} depth={depth + 1} />
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
