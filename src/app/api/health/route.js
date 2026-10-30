import { NextResponse } from "next/server";
import { readBuildInfo } from "@/lib/build-info";
import { describeCredentials } from "@/lib/credentials";

/**
 * GET /api/health — T22 (design D5): the one-string answer to "does this pod
 * serve this tree?" under a compiled server, plus the process facts a probe
 * wants. Read-only; no auth (like every route — T25's non-goal); it discloses
 * versions and a tree hash, never a credential or a host.
 *
 *   ok           true — the server answered
 *   mode         "production" (the image's prod stage) | "development" (next dev)
 *   buildId      Next's .next/BUILD_ID, or null
 *   build        srcTreeHash, srcTreeFiles, builtAt, gitSha, gitDirty, node,
 *                docling, pypdfium2 — from build-info.json; every field null
 *                under the dev target (never fabricated)
 *   uptimeSec    process uptime
 *   rssMi        the Node process's resident set, in MiB (F-65's curve, from inside)
 *   credentials  T23 (design D1 / D6): which server-side credential each
 *                endpoint kind has — "env" (the Secret), "workload" (the
 *                pod's own service-account token; the vector store), or
 *                "none". Presence only: no value, no length, no host.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const { mode, buildId, build } = readBuildInfo();
  return NextResponse.json({
    ok: true,
    mode,
    buildId,
    build,
    uptimeSec: Math.round(process.uptime()),
    rssMi: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    node: process.version,
    credentials: describeCredentials(),
  });
}
