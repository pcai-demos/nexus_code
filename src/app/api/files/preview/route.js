import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
// E2 (CA-003): the one containment rule for a caller-named path (src/lib/coding/paths.js).
import { resolveInside, PathContainmentError } from "@/lib/coding/paths";

export const dynamic = "force-dynamic";

// The file browser lists public/demos/demo_files and sends each path as "/demos/demo_files/<...>" (the
// public-relative form the static server uses); the preview reads nothing outside that folder.
const PREVIEW_ROOT = path.join(process.cwd(), "public", "demos", "demo_files");
const PREVIEW_PREFIX = "demos/demo_files/";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const relPath = searchParams.get("path");

    if (!relPath) {
      return NextResponse.json({ success: false, error: "File path parameter missing" }, { status: 400 });
    }

    // E2 (CA-003): resolve INSIDE public/demos/demo_files — "?path=../package.json" answered HTTP 200 with the
    // file on 2026-10-02 (audit §4); a path that leaves the folder is HTTP 403 before anything is read.
    let cleanPath = relPath.replace(/\\/g, "/");
    if (cleanPath.startsWith("/")) cleanPath = cleanPath.slice(1);
    if (cleanPath.startsWith(PREVIEW_PREFIX)) cleanPath = cleanPath.slice(PREVIEW_PREFIX.length);
    let fullPath;
    try {
      fullPath = resolveInside(PREVIEW_ROOT, cleanPath);
    } catch (err) {
      if (err instanceof PathContainmentError) {
        return NextResponse.json({ success: false, error: "Path outside the demo files folder", code: err.code }, { status: 403 });
      }
      throw err;
    }
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json({ success: false, error: "File not found on disk" }, { status: 404 });
    }

    const ext = path.extname(fullPath).toLowerCase();
    const stats = fs.statSync(fullPath);

    if (ext === ".pdf") {
      return NextResponse.json({
        success: true,
        type: "pdf",
        path: relPath,
        size: stats.size
      });
    }

    if ([".docx", ".pptx", ".xlsx", ".doc", ".ppt", ".xls"].includes(ext)) {
      try {
        const officeParser = require("officeparser");
        const fileBuffer = fs.readFileSync(fullPath);
        const cleanExt = ext.replace(".", "");
        const ast = await officeParser.parseOffice(fileBuffer, { fileType: cleanExt });
        
        let text = "";
        if (ast && typeof ast.toText === "function") {
          text = ast.toText();
        } else if (typeof ast === "string") {
          text = ast;
        } else if (ast && ast.content) {
          text = JSON.stringify(ast.content, null, 2);
        }

        const metadata = ast?.metadata || null;

        return NextResponse.json({
          success: true,
          type: "office",
          ext,
          text: text.trim() || "No text content extracted from Office document.",
          metadata
        });
      } catch (err) {
        console.error(`[Office Preview Parser Error for ${relPath}]:`, err);
        return NextResponse.json({
          success: true,
          type: "office_error",
          ext,
          text: `Office document parse error:\n${err.message}`
        });
      }
    }

    // Plain text / Markdown / Code / JSON / CSV files
    const content = fs.readFileSync(fullPath, "utf-8");
    return NextResponse.json({
      success: true,
      type: ext === ".md" ? "md" : "text",
      ext,
      text: content
    });

  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
