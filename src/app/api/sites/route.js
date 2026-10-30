import { NextResponse } from "next/server";

// Disable TLS check for internal dev namespace API
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const mockSites = {
  "SITE_001": { address: "London, United Kingdom", city: "London" },
  "SITE_002": { address: "Dublin, Ireland", city: "Dublin" },
  "SITE_003": { address: "Galway, Ireland", city: "Galway" },
  "SITE_004": { address: "New York, USA", city: "New York" },
  "SITE_005": { address: "Paris, France", city: "Paris" },
  "SITE_006": { address: "Tokyo, Japan", city: "Tokyo" },
  "SITE_007": { address: "Frankfurt, Germany", city: "Frankfurt" }
};

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id") || "SITE_003";

    // 1. Attempt to fetch site details dynamically from the primary Nexus Database API
    try {
      const response = await fetch(
        `https://nexusapi.demo.lon-pcai.twlon.com/database/tables/sites/select`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            columns: ["address"],
            where: `loc_code = '${id}'`,
            limit: 1,
          }),
          signal: AbortSignal.timeout(4000)
        }
      );

      if (response.ok) {
        const data = await response.json();
        const address = data?.rows?.[0]?.address;
        if (address) {
          const city = address.split(",")[0].trim();
          return NextResponse.json({ address, city });
        }
      }
    } catch (apiErr) {
      console.warn("[Sites API Proxy Warning] Remote fetch failed, falling back to local site map:", apiErr.message);
    }
    
    // 2. Fallback to local site map
    const site = mockSites[id] || mockSites["SITE_003"];
    return NextResponse.json(site);
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
