// Navigation structure for the Nexus Global Industries intranet
// Each business unit has a label (displayed in the nav bar) and
// an array of department sub-items revealed on hover.

const navigation = [
  {
    id: "sales",
    label: "Sales",
    departments: [
      "Enterprise Sales",
      "Marketing",
      "Business Development",
    ],
  },
  {
    id: "corporate",
    label: "Corporate",
    departments: [
      "Human Resources",
      "Finance",
      "Legal & Compliance",
      "Health & Wellbeing",
    ],
  },
  {
    id: "engineering",
    label: "Engineering",
    departments: [
      "Software Development",
      "R&D and Innovation Labs",
      "Quality Assurance",
    ],
  },
  {
    id: "itops",
    label: "IT Operations",
    departments: ["Customer Support Services"],
  },
  {
    id: "security",
    label: "Security",
    departments: [
      "IT & Digital Security",
      "Site & Real Estate Security",
    ],
  },
  {
    id: "nexusai",
    label: "NEXUS AI",
    departments: [
      "NexCODE",
      "NexBOT",
      "NexEYE",
      "FINNex",
      "ComplyNEX",
      "SUPNex",
      "NEXHealth",
      "NEXMaint",
      "NEXDefence",
      "NEXAgent",
      "DocuNEX",
    ],
  },
];

export default navigation;
