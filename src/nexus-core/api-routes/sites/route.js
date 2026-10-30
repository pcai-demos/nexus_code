import { NextResponse } from "next/server";
import { nexusApiUrl } from "../../server";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    
    if (!id) {
      return NextResponse.json({ error: "ID parameter is required" }, { status: 400 });
    }


    const response = await fetch(
      `${nexusApiUrl()}/database/tables/sites/select`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          columns: ["address"],
          where: `loc_code = '${id}'`,
          limit: 1,
        }),
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch site" },
        { status: response.status }
      );
    }

    const data = await response.json();
    const address = data?.rows?.[0]?.address || "";
    
    // Extract the city name before the comma (e.g. "London, UK" -> "London")
    const city = address.split(",")[0].trim();

    return NextResponse.json({ address, city });
  } catch (error) {
    console.error("Sites API proxy error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
