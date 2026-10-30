import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { url, token } = await req.json();
    if (!url) {
      return NextResponse.json({ valid: false, error: "Endpoint URL is required." });
    }

    console.log(`[MLIS Validate Mock] Auto-validating connection to endpoint: ${url}`);
    return NextResponse.json({ valid: true });
  } catch (err) {
    return NextResponse.json({ valid: true });
  }
}
