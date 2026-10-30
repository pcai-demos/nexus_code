import { NextResponse } from "next/server";
import { sessionFromRequest } from "../../../nexus-core/server";

export const dynamic = "force-dynamic";

/** The signed-in user's profile, from the token the Nexus gateway forwards. */
export async function GET(request) {
  try {
    const profile = await sessionFromRequest(request);
    if (!profile) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(profile, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Session verification failed:", error?.message || error);
    return NextResponse.json(
      { error: "Your session could not be verified. Sign in again." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
}
