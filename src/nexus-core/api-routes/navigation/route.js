import { NextResponse } from "next/server";
import { nexusApiUrl } from "../../server";

export async function GET() {
  try {

    const response = await fetch(
      `${nexusApiUrl()}/database/tables/navbar_departments/select`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          columns: ["*"],
        }),
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch navigation data" },
        { status: response.status }
      );
    }

    const data = await response.json();
    const rows = data?.rows || [];

    // Group rows into parent-child structure
    const mainDepts = rows.filter((r) => r.parent_id === null);
    
    // Sort main departments by their id to preserve catalog ordering
    mainDepts.sort((a, b) => a.id - b.id);

    const structuredNav = mainDepts.map((main) => {
      const subs = rows.filter((r) => r.parent_id === main.id);
      // Sort sub-departments by id to preserve order
      subs.sort((a, b) => a.id - b.id);
      
      return {
        id: main.department_code,
        label: main.department_name,
        url: main.url || "",
        departments: subs.map((sub) => ({
          id: sub.department_code,
          label: sub.department_name,
          url: sub.url || "",
        })),
      };
    });

    return NextResponse.json(structuredNav);
  } catch (error) {
    console.error("Navigation API proxy error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
