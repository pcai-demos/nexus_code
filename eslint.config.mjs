// eslint.config.mjs — E4 (Enablers PR, audit CA-016, 2026-10-06).
//
// `next lint` no longer exists in Next 16 and no configuration existed, so `npm run lint` was dead while two shipped
// ReferenceErrors sat in page.js (CA-006 `motion`, CA-007 `setCumulativeTokens`). This is the Next flat config
// (react, react-hooks, @next/next, import, jsx-a11y; browser + node globals) plus `no-undef` as an ERROR — the one
// rule that catches a variable read where it was never declared, which `npm test` and `next build` cannot see when
// a catch swallows the ReferenceError (F-253, memory orchestrator-no-undef-before-a-roll).
//
// Findings inside FROZEN files (src/lib/rag/**, src/lib/ingestion/**, src/lib/vectordb/**, src/app/api/ingest/**,
// src/app/api/rag/**, src/app/extracted_images/**, tests/**, scripts/**) are LISTED in the PR that meets them, never
// fixed by a coding-side change. `npm run lint` = `eslint .`.
import nextConfig from "eslint-config-next";

const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "nexcode-data/**",
      "public/**",
      // Recorded harness output (answers, traces) — data, not code.
      "tests/eval/baselines/**/records/**",
      // The owner's working documents and the audit's probe copies — not part of the runtime.
      "inputs/**",
      "scratch/**",
    ],
  },
  ...nextConfig,
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    rules: {
      "no-undef": "error",
      // eslint-plugin-react-hooks 7 ships the React Compiler heuristic "set-state-in-effect" as an error. It flags
      // the admin drawer's reset-of-local-state when it opens, the IDE panel's mount-time health check and the
      // store drawer's preview reset — deliberate patterns whose rewrite is CA-017's split (parked). A warning,
      // listed in every PR; never an error that would hide a no-undef failure behind the noise.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // Platform modules (the Nexus chrome and the demo-info panel) are shared with sibling demos and left alone
    // (brief v0.2, D-list parked); their cosmetic findings are warnings so the gate reads the coding files.
    files: ["src/nexus-core/**", "src/nexus-demo-info/**"],
    rules: {
      "react/no-unescaped-entities": "warn",
    },
  },
];

export default config;
