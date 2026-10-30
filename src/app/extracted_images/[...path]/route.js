import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { resolvePublicPath, PathOutsidePublicError } from "@/lib/ingestion/paths";
import { INGEST_ERROR_CODES as INGEST_CODES } from "@/lib/ingestion/state";

/**
 * GET /extracted_images/<docHash>/<file> — T22 (design §11a A16, finding F-94).
 *
 * The parser writes diagram crops to public/extracted_images/<docHash>/ at
 * INGEST time and the chunks cite them through `imagePath`. Next's production
 * server (`next start`) indexes public/ once at boot, so a crop written after
 * the pod started 404ed until the next restart — measured after the D13
 * re-pin: 33 of 40 sampled corpus images, every one present on disk. This
 * route serves the directory at request time. A file Next knew at boot is
 * still served by its static handler (the same bytes); anything newer falls
 * through to here.
 *
 * The request path is rooted under extracted_images/ and resolved through the
 * one path rule (F-59, `resolvePublicPath`), then required to stay inside the
 * crops directory itself — nothing else under public/ is reachable through
 * this route. Only image types are served; an absent file is a typed 404.
 * Crops are regenerated under the same names by a re-parse, so responses are
 * not long-cached.
 */
export const dynamic = "force-dynamic";

const CROPS_ROOT = path.join(process.cwd(), "public", "extracted_images");
const IMAGE_TYPES = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
});

function notFound(message) {
  return NextResponse.json({ success: false, code: INGEST_CODES.FILE_NOT_FOUND, error: message }, { status: 404 });
}

export async function GET(_request, context) {
  const params = await context.params;
  const segments = Array.isArray(params?.path) ? params.path : [];
  if (segments.length === 0 || segments.some((s) => typeof s !== "string" || !s)) return notFound("No crop named.");

  let resolved;
  try {
    resolved = resolvePublicPath(path.posix.join("extracted_images", ...segments));
  } catch (err) {
    if (err instanceof PathOutsidePublicError) {
      return NextResponse.json({ success: false, code: err.code, error: err.message }, { status: err.status });
    }
    throw err;
  }
  if (!resolved.startsWith(CROPS_ROOT + path.sep)) {
    return NextResponse.json(
      { success: false, code: INGEST_CODES.PATH_OUTSIDE_PUBLIC, error: "Refused: this route serves public/extracted_images/ only." },
      { status: 400 }
    );
  }

  const type = IMAGE_TYPES[path.extname(resolved).toLowerCase()];
  if (!type) return notFound(`Not an image crop: ${segments.join("/").slice(0, 200)}`);

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (err) {
    return notFound(`No such crop: ${segments.join("/").slice(0, 200)}`);
  }
  if (!stat.isFile()) return notFound(`No such crop: ${segments.join("/").slice(0, 200)}`);

  const body = fs.readFileSync(resolved);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(body.length),
      "Cache-Control": "no-cache",
      "Last-Modified": stat.mtime.toUTCString(),
    },
  });
}
