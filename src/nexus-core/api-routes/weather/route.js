import { NextResponse } from "next/server";
import { nexusApiUrl } from "../../server";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get("city");
    
    if (!city) {
      return NextResponse.json({ error: "City parameter is required" }, { status: 400 });
    }


    const response = await fetch(
      `${nexusApiUrl()}/weather?city=${encodeURIComponent(city)}`
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
