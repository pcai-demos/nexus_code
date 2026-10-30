import { NextResponse } from "next/server";
import { execSync } from "child_process";

export async function GET() {
  try {
    console.log("[MLIS Endpoints] Querying KServe InferenceServices via kubectl...");
    const stdout = execSync("kubectl get inferenceservice -A -o json", { encoding: "utf8" });
    const data = JSON.parse(stdout);
    
    const items = data.items || [];
    const endpoints = items.map(item => {
      const name = item.metadata.name;
      const namespace = item.metadata.namespace;
      const url = item.status?.url || "";
      
      return {
        name: `${name} (${namespace})`,
        url: url
      };
    }).filter(ep => ep.url);

    console.log(`[MLIS Endpoints] Found ${endpoints.length} active model endpoints.`);
    return NextResponse.json({ endpoints });
  } catch (err) {
    console.error("[MLIS Endpoints] Failed to list InferenceServices via kubectl:", err.message);
    // Fallback to cluster default endpoints if kubectl fails (development/deployment resilience)
    return NextResponse.json({
      endpoints: [
        { name: "nemotron (project-demos)", url: "https://nemotron.project-demos.serving.demo.lon-pcai.twlon.com" },
        { name: "embed (project-demos)", url: "https://embed.project-demos.serving.demo.lon-pcai.twlon.com" },
        { name: "rerank (project-demos)", url: "https://rerank.project-demos.serving.demo.lon-pcai.twlon.com" }
      ]
    });
  }
}
