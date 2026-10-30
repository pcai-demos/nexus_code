import { NextResponse } from "next/server";
// T23 (design D7) — the field's value when typed, else the server's credential bound to this endpoint's origin; the response says which.
import { resolveCredential } from "@/lib/credentials";

export async function POST(request) {
  // T23 (design D7): which source served this test's credential — a name, never a value.
  let credentialSource = "none";
  try {
    const { url, token } = await request.json();

    if (!url) {
      return NextResponse.json(
        { credentialSource, success: false, error: "Missing Vector DB Endpoint URL" },
        { status: 400 }
      );
    }

    const cred = resolveCredential({ url, requestValue: token || "" });
    credentialSource = cred.source;
    const cleanToken = cred.value;
    const headers = {};
    if (cleanToken) {
      headers["x-auth-token"] = cleanToken;
    }

    const start = Date.now();
    const res = await fetch(`${url}/v1/meta`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10000), // 10 seconds timeout
    });

    const latency = Date.now() - start;
    const bodyText = await res.text();

    if (res.ok) {
      let parsedData = {};
      try {
        parsedData = JSON.parse(bodyText);
      } catch (err) {
        parsedData = { raw: bodyText };
      }

      return NextResponse.json({ credentialSource,
        success: true,
        latency,
        status: res.status,
        data: parsedData,
      });
    } else {
      return NextResponse.json({ credentialSource,
        success: false,
        latency,
        status: res.status,
        error: bodyText || `HTTP error ${res.status}`,
      });
    }
  } catch (error) {
    return NextResponse.json(
      { credentialSource, success: false, error: error.message },
      { status: 500 }
    );
  }
}
