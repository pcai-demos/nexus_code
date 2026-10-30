import { NextResponse } from "next/server";

const staticNavData = [
  {
    id: "sales",
    label: "Sales",
    departments: [
      { id: "ent_sales", label: "Enterprise Sales", url: "" },
      { id: "marketing", label: "Marketing", url: "" },
      { id: "biz_dev", label: "Business Development", url: "" }
    ]
  },
  {
    id: "corporate",
    label: "Corporate",
    departments: [
      { id: "hr", label: "Human Resources", url: "" },
      { id: "finance", label: "Finance", url: "" },
      { id: "legal", label: "Legal & Compliance", url: "" },
      { id: "wellbeing", label: "Health & Wellbeing", url: "" }
    ]
  },
  {
    id: "engineering",
    label: "Engineering",
    departments: [
      { id: "sw_dev", label: "Software Development", url: "" },
      { id: "labs", label: "R&D and Innovation Labs", url: "" },
      { id: "qa", label: "Quality Assurance", url: "" }
    ]
  },
  {
    id: "itops",
    label: "IT Operations",
    departments: [
      { id: "support", label: "Customer Support Services", url: "" }
    ]
  },
  {
    id: "security",
    label: "Security",
    departments: [
      { id: "cyber_sec", label: "IT & Digital Security", url: "" },
      { id: "site_sec", label: "Site & Real Estate Security", url: "" }
    ]
  },
  {
    id: "nexusai",
    label: "NEXUS AI",
    departments: [
      { id: "nexcode", label: "NexCODE", url: "/" },
      { id: "nexbot", label: "NexBOT", url: "" },
      { id: "nexeye", label: "NexEYE", url: "" },
      { id: "finnex", label: "FINNex", url: "" },
      { id: "complynex", label: "ComplyNEX", url: "" },
      { id: "supnex", label: "SUPNex", url: "" },
      { id: "nexhealth", label: "NEXHealth", url: "" },
      { id: "nexmaint", label: "NEXMaint", url: "" },
      { id: "nexdefence", label: "NEXDefence", url: "" },
      { id: "nexagent", label: "NEXAgent", url: "" },
      { id: "docunex", label: "DocuNEX", url: "" }
    ]
  }
];

export async function GET() {
  try {
    return NextResponse.json(staticNavData);
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
