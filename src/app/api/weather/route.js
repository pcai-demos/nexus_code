import { NextResponse } from "next/server";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get("city") || "Frankfurt";
    
    // Return static mock weather payload to avoid remote fetch timeouts
    const mockWeatherData = {
      location: city,
      current: {
        weather_code: 1, // 1 = Partly Cloudy
        weather_description: "Partly Cloudy",
        temperature: 19,
        wind_speed: 12
      }
    };
    
    return NextResponse.json(mockWeatherData);
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
