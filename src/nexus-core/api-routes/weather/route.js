import { NextResponse } from "next/server";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get("city");
    
    if (!city) {
      return NextResponse.json({ error: "City parameter is required" }, { status: 400 });
    }

    // Bypass SSL certificate validation for self-signed certificates in dev namespace
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const response = await fetch(
      `https://nexusapi.demo.lon-pcai.twlon.com/weather?city=${encodeURIComponent(city)}`
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch weather" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Weather API proxy error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
