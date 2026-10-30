"use client";

import React, { useState, useEffect } from "react";
// E1 (CA-006, 2026-10-06): `motion` is rendered by the "Workspace Minimised" block below; it was never imported,
// so hiding both panels threw "motion is not defined" and replaced the page (reproduced live 2026-10-02).
import { AnimatePresence, motion } from "framer-motion";

import { useUser } from "@/context/UserContext";
import Sidebar from "@/components/Sidebar";
import ChatPanel from "@/components/ChatPanel";
import VisualStage from "@/components/VisualStage";
import AdminDrawer from "@/components/AdminDrawer";
import StatsDrawer from "@/components/StatsDrawer";
import StandardsDrawer from "@/components/StandardsDrawer";
import FileBrowserDrawer from "@/components/FileBrowserDrawer";
import TracingDrawer from "@/components/TracingDrawer";
// Presenter panels (inputs/demo-design/presenter-panels-design.md, 2026-10-07): the gated step bar above the composer
// (it replaces Machinery PR 1's scenario strip), the Demo panel over the workbench, and the context through which a
// finished answer's chips reach the panel.
import StepBar from "@/components/StepBar";
import DemoPanel from "@/components/presenter/DemoPanel";
import DemoSelect from "@/components/presenter/DemoSelect";
// The two-level reset (2026-10-07, D1 (a)): the sidebar's reset icon opens it.
import ResetMenu from "@/components/presenter/ResetMenu";
// PR B (the owner's D1-D7 of 2026-10-07): the Results panel and the Documents panel.
import ResultsPanel from "@/components/presenter/ResultsPanel";
import DocumentsPanel from "@/components/presenter/DocumentsPanel";
import { PresenterProvider } from "@/context/PresenterContext";
import { RiCodeBoxLine, RiLoader4Line } from "@remixicon/react";
import { loadRagSettings } from "@/lib/rag/config";
import { figureSuffix } from "@/lib/ingestion/outcomes";
// T15 (design D2, D10): the ONE routing rule, shared with the server.
import { routeTurn } from "@/lib/rag/router";
import { aggregateSessionTiming } from "@/lib/rag/timing";
// Machinery PR 1 (design §4, D6): the streamed coding turn's reader and the live bubble's state.
import { readCodingTurn, liveTurnReducer } from "@/lib/coding/turn_client";

const MASTER_SYSTEM_PROMPT = `You are NexCODE, an advanced Document Intelligence and Multimodal RAG Assistant.
Your core mission is to answer user queries with absolute precision and clarity, grounding your responses directly in the ingested document context, tables, visual diagrams, and figures loaded in the vector store.

### 1. FOUNDATIONAL RULES & BEHAVIOR
- **Locale & Style:** Use British English (en_GB) for all text. Maintain an educated, clear, and business-casual tone.
- **Natural Structure:** Answer the user's question directly and concisely. Do NOT output arbitrary software engineering or compliance boilerplates (such as 'Pull Request Summary' or 'Security Compliance') unless explicitly requested by the user.
- **RAG Grounding:** Base your answers strictly on the retrieved document passages, tables, and visual diagram captions provided in the context.
- **Precision:** When specific numbers, dimensions, measurements, or values are present in the retrieved context, state them explicitly.`;

// T17 (design D1, F-83): the RAG settings table lives in ONE module the
// server reads through — page.js's own literal used to carry
// minRerankScore 0.0, which switched T08's calibrated floor off for every
// demo chat turn while the resolver's default said 0.05. The loader (D6)
// whitelists a persisted blob against the same table; the schema line the
// admin panel shows is computed by the same two functions the server calls.

// T07 (design D9): every terminal ingest status closes the progress stream.
// Before T07 only "completed" and "error" did, so a cancelled job's stream
// was never closed.
const INGEST_TERMINAL_STATUSES = ["completed", "partial", "error", "cancelled", "interrupted"];

export default function DashboardPage() {
  const { user } = useUser();

  const formatTime = () => {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  // App Layout / View Configs
  const [chatOpen, setChatOpen] = useState(true);
  const [ideOpen, setIdeOpen] = useState(true);
  const [isStandardsOpen, setIsStandardsOpen] = useState(false);
  const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);
  const [loadedFiles, setLoadedFiles] = useState([]);
  // T15 (design D11): the store's documents (for the composer's scope
  // selector) and the one selected — "" means all documents, and the
  // question decides. Re-read after an ingest or when the drawer closes.
  const [storeDocuments, setStoreDocuments] = useState([]);
  const [documentScopeSelection, setDocumentScopeSelection] = useState("");
  const refreshStoreDocuments = async (overrides = {}) => {
    try {
      const body = {
        weaviateUrl: overrides.weaviateUrl ?? weaviateUrl,
        mlisToken: overrides.mlisToken ?? mlisToken,
        ...(ragSettings?.weaviateCollection ? { weaviateCollection: ragSettings.weaviateCollection } : {}),
        ...(ragSettings?.schemaVersion !== undefined && ragSettings?.schemaVersion !== null ? { schemaVersion: ragSettings.schemaVersion } : {}),
      };
      const res = await fetch("/api/rag/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) return;
      const data = await res.json();
      const docs = Array.isArray(data.documents) ? data.documents : [];
      setStoreDocuments(docs);
      setDocumentScopeSelection((prev) => (prev && !docs.some((d) => d.source === prev) ? "" : prev));
    } catch (e) {
      // The selector is a convenience; a failed read leaves it empty.
    }
  };
  const [ingestionProgress, setIngestionProgress] = useState(null);

  // Ingestion handler proxy with Server-Sent Events progress tracking
  const triggerIngestion = async (newFiles) => {
    if (!newFiles || newFiles.length === 0) return;

    setIngestionProgress({
      status: "processing",
      currentFile: newFiles[0].name,
      progressPercent: 0,
      elapsedSeconds: 0,
      etaSeconds: 0,
      chunksIndexed: 0,
      totalFiles: newFiles.length,
      filesCompleted: 0
    });

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePaths: newFiles.map(f => f.path),
          weaviateUrl,
          token: embedApiKey,
          weaviateToken: mlisToken,
          embedUrl: embedEndpointUrl,
          embedModel: embedModelName,
          // T17 (design D11, F-85): the captioner's identity, top-level like
          // the embed pair — before T17 these fields fed the connection test
          // only and every ingest captioned with the parser's defaults.
          vlmModelName,
          vlmEndpointUrl,
          vlmApiKey,
          ragSettings
        })
      });

      const startBody = await res.json().catch(() => null);

      if (!res.ok) {
        // T12: a refused concurrent ingest (409 INGEST_IN_PROGRESS) is a
        // specific, actionable condition — show it instead of a generic
        // "Failed to start ingestion queue".
        throw new Error(
          startBody?.error ||
            `Failed to start ingestion queue (HTTP ${res.status}${startBody?.code ? `, ${startBody.code}` : ""})`
        );
      }

      // F-18: follow OUR job, not whatever the server is doing. Reading the
      // global stream is how a driver ends up watching a foreign job complete.
      const jobId = startBody?.jobId || null;
      const statusUrl = jobId ? `/api/ingest/status?jobId=${jobId}` : "/api/ingest/status";

      // Resilient progress tracking with automatic retry & reconnect
      let retryCount = 0;
      const maxRetries = 12;

      const connectSSE = () => {
        const eventSource = new EventSource(statusUrl);
        
        eventSource.onmessage = (event) => {
          try {
            const state = JSON.parse(event.data);
            setIngestionProgress(state);
            retryCount = 0; // Reset retry counter on message received

            // T17 (design D4, F-51): the profiler's recommendation
            // (state.lastProfile) is a fact about the document, shown where the
            // frame is shown and applied nowhere — it used to be copied into
            // the person's chunk settings and search mode after every ingest,
            // a skipped one included, undoing the sliders.

            if (INGEST_TERMINAL_STATUSES.includes(state.status)) {
              eventSource.close();
              if (state.status === "completed") {
                setTimeout(() => setIngestionProgress(null), 4000);
                // T15 (design D11): the store changed — re-read the scope selector's list.
                refreshStoreDocuments();
              }
            }
          } catch (err) {
            console.warn("[SSE Parse Warning]:", err);
          }
        };

        eventSource.onerror = async () => {
          eventSource.close();
          retryCount++;
          
          if (retryCount <= maxRetries) {
            console.log(`[Ingestion Stream] Reconnecting to progress updates (attempt ${retryCount}/${maxRetries})...`);
            // T17 (design D14, F-27): the "REST fallback" that awaited .json()
            // on the status URL is gone — the route is an SSE stream, so the
            // parse could never succeed and the catch swallowed it. The
            // reconnect itself is the recovery.
            setTimeout(connectSSE, 2000);
          } else {
            setIngestionProgress({
              status: "error",
              error: "Connection to progress updates stream was lost after multiple reconnect attempts."
            });
          }
        };
      };

      connectSSE();

    } catch (err) {
      console.error("Ingestion initiation failed:", err);
      setIngestionProgress({
        status: "error",
        error: err.message
      });
    }
  };
  
  // Sheet Visibility
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isTracingOpen, setIsTracingOpen] = useState(false);
  // Presenter panels (design §2, §3): the Demo panel, the request that opened it (section, scenario, cited passages)
  // and the demo the presenter selected (the step bar follows it).
  const [isDemoOpen, setIsDemoOpen] = useState(false);
  // Polish (PL-D1 (a) of 2026-10-14): the demo selection screen the Demo icon opens, before the Demo panel.
  const [isDemoSelectOpen, setIsDemoSelectOpen] = useState(false);
  // PR B: the Documents panel (it replaced Store Admin) and the Results panel, with the request that opened the latter.
  const [isDocsOpen, setIsDocsOpen] = useState(false);
  const [isResultsOpen, setIsResultsOpen] = useState(false);
  const [resultsRequest, setResultsRequest] = useState(null);
  const [demoRequest, setDemoRequest] = useState(null);
  const [activeDemoId, setActiveDemoId] = useState(null);
  // Presenter flow (2026-10-07): each successful Apply and each environment reset ticks this, so the step bar re-reads
  // its states at once; the reset menu's open state.
  const [workspaceTick, setWorkspaceTick] = useState(0);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [traceHistory, setTraceHistory] = useState([]);

  // System Configurations (In-Memory Only)
  const [nimEndpoint, setNimEndpoint] = useState("https://nemotron.project-demos.serving.demo.lon-pcai.twlon.com");
  const [nimApiKey, setNimApiKey] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(MASTER_SYSTEM_PROMPT);
  const [modelName, setModelName] = useState("nvidia/nemotron-nano-12b-v2-vl");
  const [temperature, setTemperature] = useState(0.1);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [weaviateUrl, setWeaviateUrl] = useState("http://weaviate.hpe-weaviate.svc.cluster.local:80");
  // T17: the legacy weaviateLimit / weaviateSimilarityThreshold /
  // weaviateSearchStrategy trio (copies of the blob that won precedence over
  // it — F-84), weaviateTimeout (no input, no reader) and the bare
  // embedEndpoint (a second state for embedEndpointUrl — F-21) are gone.
  const [endpointType, setEndpointType] = useState("ollama");
  const [mlisUrl, setMlisUrl] = useState("https://nemotron.project-demos.serving.demo.lon-pcai.twlon.com");
  // T23 (design D5): NO credential has a committed default any more. The
  // three service-account JWTs and the LiteLLM key that sat here since
  // session 4 live in the cluster's `nexcode-credentials` Secret and reach
  // the server as runtime env, read only by src/lib/credentials.js; a blank
  // field means "use the server's" (the drawer says whether it has one).
  // A key typed here is user-owned and wins for that request (design D4).
  const [mlisToken, setMlisToken] = useState("");
  const [liteLlmUrl, setLiteLlmUrl] = useState("https://litellm.demo.lon-pcai.twlon.com/v1/");
  const [liteLlmToken, setLiteLlmToken] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("https://ollama.demo.lon-pcai.twlon.com/v1/");
  // E7 (CA-013, 2026-10-06): Ollama takes no key — the two numeric placeholders that sat here (ollamaToken,
  // codeOllamaToken) are empty like every other token field (T23's rule); a key typed in the drawer still wins
  // for that request. The captioner's vlmApiKey is a RAG-phase field and is left as it is.
  const [ollamaToken, setOllamaToken] = useState("");

  // T15 (design D8, amended by the owner 2026-09-10): the chat agent's
  // default is Ollama with qwen3.8:27b — the model every dry run has been
  // judged on; MLIS nemotron is never the chat default. The code agent's
  // default is the same model (one resident model for chat and code).
  const [ollamaModelName, setOllamaModelName] = useState("qwen3.8:27b");
  const [liteLlmModelName, setLiteLlmModelName] = useState("qwen3-coder:30b");

  // Code Agent Model Connection Settings
  const [codeEndpointType, setCodeEndpointType] = useState("ollama");
  const [codeMlisUrl, setCodeMlisUrl] = useState("https://nemotron.project-demos.serving.demo.lon-pcai.twlon.com");
  const [codeMlisToken, setCodeMlisToken] = useState("");
  const [codeLiteLlmUrl, setCodeLiteLlmUrl] = useState("https://litellm.demo.lon-pcai.twlon.com/v1/");
  const [codeLiteLlmToken, setCodeLiteLlmToken] = useState("");
  const [codeOllamaUrl, setCodeOllamaUrl] = useState("https://ollama.demo.lon-pcai.twlon.com/v1/");
  const [codeOllamaToken, setCodeOllamaToken] = useState("");
  const [codeOllamaModelName, setCodeOllamaModelName] = useState("qwen3.8:27b");
  const [codeLiteLlmModelName, setCodeLiteLlmModelName] = useState("qwen3-coder:30b");

  // RAG Agent Model Settings — T08 (F-12): the embed defaults must name the
  // pair the collections are actually built with — qwen3-embedding:8b
  // (4096-dim) served by Ollama. The previous defaults named a 2560-dim MLIS
  // model, so every browser without saved admin settings queried the wrong
  // vector space. The MLIS 2560-dim alternative stays available as an
  // explicit admin-panel choice, never as a silent default.
  const [embedModelName, setEmbedModelName] = useState("qwen3-embedding:8b");
  const [embedEndpointUrl, setEmbedEndpointUrl] = useState("http://ollama.ollama.svc.cluster.local:11434/v1");
  const [embedApiKey, setEmbedApiKey] = useState("");
  const [rerankModelName, setRerankModelName] = useState("Qwen/Qwen3-Reranker-8B");
  const [rerankEndpointUrl, setRerankEndpointUrl] = useState("https://rerank.project-demos.serving.demo.lon-pcai.twlon.com");
  const [rerankApiKey, setRerankApiKey] = useState("");
  // T37 (design D1, D2): the default captioner is the chat model qwen3.8:27b
  // (T32's arm C). A string LITERAL on purpose — the page-shape runners
  // (run_dry_run.js, witness_production.js, repin_production.js) read it by
  // regex — pinned equal to vlm_captioner.js's DEFAULT_CAPTION_MODEL by
  // U-SETTINGS. The value is part of every document's version fingerprint.
  const [vlmModelName, setVlmModelName] = useState("qwen3.8:27b");
  const [vlmEndpointUrl, setVlmEndpointUrl] = useState("https://ollama.demo.lon-pcai.twlon.com/v1/");
  const [vlmApiKey, setVlmApiKey] = useState("1234567890");

  const [ragSettings, setRagSettings] = useState(() => loadRagSettings(null));

  // Tab Visibility Toggles
  const [chatAgentToggle, setChatAgentToggle] = useState(true);
  const [codeAgentToggle, setCodeAgentToggle] = useState(true);
  const [ragAgentToggle, setRagAgentToggle] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      // Run once migration to enforce the new defaults for the presenter panel
       // T17 (design D6): guard v8 — the committed defaults changed (the
       // blob's floor, similarity, depth and context; the trio and the bare
       // embed endpoint removed), so browsers that migrated under v7 are
       // reset once more. The v8 block also removes the keys T17 retired.
       // T23 (design D5): guard v9 — the credentials LEFT the source. The
       // v7 / v8 blocks seeded the committed service-account tokens into
       // every visitor's localStorage, and the drawer's Save persisted the
       // committed defaults under the same keys for anyone who pressed it.
       // The v9 block REMOVES every token key once, so a returning browser
       // sends none and the server's own credential (the Secret, or the
       // pod's workload identity) serves the call; the owner's rotation
       // would otherwise present as F-22's silent 403 in every browser that
       // had visited before. A presenter who typed their own key types it
       // once more. No value is seeded here any more — and never again.
       // T28 (design D4, D19; T17's rule): guard v10 — the settings table
       // gained pageCompanions / enumerationScope / documentContextBudget,
       // so a blob saved under v9 is dropped once and the loader's defaults
       // apply; nothing else changes.
       // T15 (design D8, D12; T17's rule): guard v11 — the chat default moved
       // to Ollama qwen3.8:27b (the code agent's model too), and the settings
       // table gained lookupScope; a blob saved under v10 is dropped once.
       // T24 (design D6; T17's rule): guard v12 — the settings table gained
       // captionFigures; a blob saved under v11 is dropped once and the
       // loader's defaults apply (captioning on). Nothing else changes.
       // T31 (workshop design D9; T17's rule): guard v13 — the settings table
       // gained captionPageBudget; a blob saved under v12 is dropped once and
       // the loader's defaults apply (every page considered). Nothing else changes.
       // T37 (design D3; T17's rule): guard v14 — the default captioner moved to
       // the chat model qwen3.8:27b (T32's arm C), and the block sets
       // nxs_vlmModelName once so a browser that pressed Save under an older
       // guard moves with it (no earlier block governed that key); a blob saved
       // under v13 is dropped once. Nothing else changes.
       // T33 (design D6; T17's rule): guard v15 — the settings table gained
       // detailPasses (auto | all | off); a blob saved under v14 is dropped
       // once and the loader's defaults apply (auto). Nothing else changes.
       // T35 (design D3; T17's rule): guard v16 — the settings table gained
       // ocrNoTextPages (auto | off); a blob saved under v15 is dropped once
       // and the loader's defaults apply (auto). Nothing else changes.
       // T48 (t48-design D4; T17's rule): guard v17 — the settings table gained
       // beyondTheDocuments (off | on); a blob saved under v16 is dropped once and
       // the loader's defaults apply (off). Nothing else changes.
       // T63 (t63-design D7 (a); T17's rule): guard v18 — the settings table gained
       // lookupDocumentRead (whole | ranked); a blob saved under v17 is dropped once
       // and the loader's defaults apply (whole). Nothing else changes.
       const hasMigratedDemos = localStorage.getItem("nxs_migrated_demos_v18");
       if (!hasMigratedDemos) {
         localStorage.setItem("nxs_endpointType", "ollama");
         localStorage.setItem("nxs_ollamaModelName", "qwen3.8:27b");
         localStorage.setItem("nxs_codeEndpointType", "ollama");
         localStorage.setItem("nxs_codeOllamaModelName", "qwen3.8:27b");
         // T37 (design D3): the captioner default, set once; the drawer's Save
         // keeps writing this key, and the read below applies it.
         localStorage.setItem("nxs_vlmModelName", "qwen3.8:27b");
         localStorage.setItem("nxs_weaviateUrl", "http://weaviate.hpe-weaviate.svc.cluster.local:80");
         localStorage.removeItem("nxs_weaviateLimit");
         localStorage.removeItem("nxs_weaviateSimilarityThreshold");
         localStorage.removeItem("nxs_weaviateSearchStrategy");
         localStorage.removeItem("nxs_weaviateTimeout");
         localStorage.removeItem("nxs_ragSettings");
         localStorage.setItem("nxs_rerankModelName", "Qwen/Qwen3-Reranker-8B");
         localStorage.setItem("nxs_rerankEndpointUrl", "https://rerank.project-demos.serving.demo.lon-pcai.twlon.com");
         localStorage.setItem("nxs_embedModelName", "qwen3-embedding:8b");
         localStorage.setItem("nxs_embedEndpointUrl", "http://ollama.ollama.svc.cluster.local:11434/v1");
         localStorage.removeItem("nxs_embedEndpoint");
         localStorage.removeItem("nxs_weaviateCollection");
         // T23: the credential keys, seeded or saved — removed once.
         localStorage.removeItem("nxs_mlisToken");
         localStorage.removeItem("nxs_codeMlisToken");
         localStorage.removeItem("nxs_embedApiKey");
         localStorage.removeItem("nxs_rerankApiKey");
         localStorage.removeItem("nxs_liteLlmToken");
         localStorage.removeItem("nxs_codeLiteLlmToken");
         for (const key of Object.keys(localStorage)) {
           if (key.startsWith("nxs_mlisToken_")) localStorage.removeItem(key);
         }
         localStorage.setItem("nxs_migrated_demos_v18", "true");
       }

      const storedEndpointType = localStorage.getItem("nxs_endpointType") || "ollama";
      setEndpointType(storedEndpointType);
      
      const storedOllamaModelName = localStorage.getItem("nxs_ollamaModelName") || "qwen3.8:27b";
      setOllamaModelName(storedOllamaModelName);

      const storedLiteLlmModelName = localStorage.getItem("nxs_liteLlmModelName") || "qwen3-coder:30b";
      setLiteLlmModelName(storedLiteLlmModelName);

      const storedSystemPrompt = localStorage.getItem("nxs_systemPrompt") || MASTER_SYSTEM_PROMPT;
      setSystemPrompt(storedSystemPrompt);

      // Load additional configuration states from localStorage if they exist
      const storedMlisUrl = localStorage.getItem("nxs_mlisUrl");
      if (storedMlisUrl !== null && storedMlisUrl.trim() !== "") setMlisUrl(storedMlisUrl);

      const storedMlisToken = localStorage.getItem("nxs_mlisToken");
      if (storedMlisToken !== null && storedMlisToken.trim() !== "") setMlisToken(storedMlisToken);

      const storedLiteLlmUrl = localStorage.getItem("nxs_liteLlmUrl");
      if (storedLiteLlmUrl !== null) setLiteLlmUrl(storedLiteLlmUrl);

      const storedLiteLlmToken = localStorage.getItem("nxs_liteLlmToken");
      if (storedLiteLlmToken !== null) setLiteLlmToken(storedLiteLlmToken);

      const storedOllamaUrl = localStorage.getItem("nxs_ollamaUrl");
      if (storedOllamaUrl !== null) setOllamaUrl(storedOllamaUrl);

      const storedOllamaToken = localStorage.getItem("nxs_ollamaToken");
      if (storedOllamaToken !== null) setOllamaToken(storedOllamaToken);

      const storedWeaviateUrl = localStorage.getItem("nxs_weaviateUrl");
      if (storedWeaviateUrl !== null) setWeaviateUrl(storedWeaviateUrl);

      // T17 (design D6, F-82): the RAG settings blob is LOADED, whitelisted
      // against RAG_SETTINGS_DEFAULTS by the module's pure loader — the
      // drawer's Save had written it since cd53609 and nothing ever read it.
      const storedRagSettings = localStorage.getItem("nxs_ragSettings");
      if (storedRagSettings !== null) setRagSettings(loadRagSettings(storedRagSettings));

      const storedTemperature = localStorage.getItem("nxs_temperature");
      if (storedTemperature !== null) setTemperature(parseFloat(storedTemperature));

      const storedMaxTokens = localStorage.getItem("nxs_maxTokens");
      if (storedMaxTokens !== null) setMaxTokens(parseInt(storedMaxTokens));

      const storedNimEndpoint = localStorage.getItem("nxs_nimEndpoint");
      if (storedNimEndpoint !== null) setNimEndpoint(storedNimEndpoint);

      const storedNimApiKey = localStorage.getItem("nxs_nimApiKey");
      if (storedNimApiKey !== null) setNimApiKey(storedNimApiKey);

      // Load Code Agent states
      const storedCodeEndpointType = localStorage.getItem("nxs_codeEndpointType");
      if (storedCodeEndpointType !== null) setCodeEndpointType(storedCodeEndpointType);

      const storedCodeMlisUrl = localStorage.getItem("nxs_codeMlisUrl");
      if (storedCodeMlisUrl !== null) setCodeMlisUrl(storedCodeMlisUrl);

      const storedCodeMlisToken = localStorage.getItem("nxs_codeMlisToken");
      if (storedCodeMlisToken !== null) setCodeMlisToken(storedCodeMlisToken);

      const storedCodeLiteLlmUrl = localStorage.getItem("nxs_codeLiteLlmUrl");
      if (storedCodeLiteLlmUrl !== null) setCodeLiteLlmUrl(storedCodeLiteLlmUrl);

      const storedCodeLiteLlmToken = localStorage.getItem("nxs_codeLiteLlmToken");
      if (storedCodeLiteLlmToken !== null) setCodeLiteLlmToken(storedCodeLiteLlmToken);

      const storedCodeOllamaUrl = localStorage.getItem("nxs_codeOllamaUrl");
      if (storedCodeOllamaUrl !== null) setCodeOllamaUrl(storedCodeOllamaUrl);

      const storedCodeOllamaToken = localStorage.getItem("nxs_codeOllamaToken");
      if (storedCodeOllamaToken !== null) setCodeOllamaToken(storedCodeOllamaToken);

      const storedCodeOllamaModelName = localStorage.getItem("nxs_codeOllamaModelName");
      if (storedCodeOllamaModelName !== null) setCodeOllamaModelName(storedCodeOllamaModelName);

      const storedCodeLiteLlmModelName = localStorage.getItem("nxs_codeLiteLlmModelName");
      if (storedCodeLiteLlmModelName !== null) setCodeLiteLlmModelName(storedCodeLiteLlmModelName);

      // Load RAG Agent states
      const storedEmbedModelName = localStorage.getItem("nxs_embedModelName");
      if (storedEmbedModelName !== null) setEmbedModelName(storedEmbedModelName);

      const storedEmbedEndpointUrl = localStorage.getItem("nxs_embedEndpointUrl");
      if (storedEmbedEndpointUrl !== null) setEmbedEndpointUrl(storedEmbedEndpointUrl);

      const storedEmbedApiKey = localStorage.getItem("nxs_embedApiKey");
      if (storedEmbedApiKey !== null) setEmbedApiKey(storedEmbedApiKey);

      const storedRerankModelName = localStorage.getItem("nxs_rerankModelName");
      if (storedRerankModelName !== null) setRerankModelName(storedRerankModelName);

      const storedRerankEndpointUrl = localStorage.getItem("nxs_rerankEndpointUrl");
      if (storedRerankEndpointUrl !== null) setRerankEndpointUrl(storedRerankEndpointUrl);

      const storedRerankApiKey = localStorage.getItem("nxs_rerankApiKey");
      if (storedRerankApiKey !== null) setRerankApiKey(storedRerankApiKey);

      const storedVlmModelName = localStorage.getItem("nxs_vlmModelName");
      if (storedVlmModelName !== null) setVlmModelName(storedVlmModelName);

      const storedVlmEndpointUrl = localStorage.getItem("nxs_vlmEndpointUrl");
      if (storedVlmEndpointUrl !== null) setVlmEndpointUrl(storedVlmEndpointUrl);

      const storedVlmApiKey = localStorage.getItem("nxs_vlmApiKey");
      if (storedVlmApiKey !== null) setVlmApiKey(storedVlmApiKey);

      // Load Visibility Toggles
      const storedChatAgentToggle = localStorage.getItem("nxs_chatAgentToggle");
      if (storedChatAgentToggle !== null) setChatAgentToggle(storedChatAgentToggle === "true");

      const storedCodeAgentToggle = localStorage.getItem("nxs_codeAgentToggle");
      if (storedCodeAgentToggle !== null) setCodeAgentToggle(storedCodeAgentToggle === "true");

      const storedRagAgentToggle = localStorage.getItem("nxs_ragAgentToggle");
      if (storedRagAgentToggle !== null) setRagAgentToggle(storedRagAgentToggle === "true");
    }
  }, []);

  // Chat/NLP States
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState([
    {
      sender: "ai",
      text: "Welcome to NexCODE. Let's write some code!",
      timestamp: ""
    }
  ]);

  // T15 (design D11): read the store's documents for the scope selector on
  // load and whenever the store connection settings change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    refreshStoreDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weaviateUrl, ragSettings?.weaviateCollection, ragSettings?.schemaVersion]);

  // Set the initial welcome message timestamp client-side only and restore session history
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const savedChat = localStorage.getItem("nxs_chatHistory");
        if (savedChat) {
          const parsed = JSON.parse(savedChat);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setChatHistory(parsed);
          }
        } else {
          setChatHistory((prev) => {
            if (prev.length === 1 && prev[0].sender === "ai" && !prev[0].timestamp) {
              return [{ ...prev[0], timestamp: formatTime() }];
            }
            return prev;
          });
        }

        const savedTraces = localStorage.getItem("nxs_traceHistory");
        if (savedTraces) {
          const parsed = JSON.parse(savedTraces);
          if (Array.isArray(parsed)) {
            setTraceHistory(parsed);
          }
        }
      } catch (e) {
        console.error("Error restoring session state from localStorage:", e);
      }
    }
  }, []);

  // Save chatHistory to localStorage on update
  useEffect(() => {
    if (typeof window !== "undefined" && chatHistory && chatHistory.length > 0) {
      localStorage.setItem("nxs_chatHistory", JSON.stringify(chatHistory));
    }
  }, [chatHistory]);

  // Save traceHistory to localStorage on update
  useEffect(() => {
    if (typeof window !== "undefined" && traceHistory) {
      localStorage.setItem("nxs_traceHistory", JSON.stringify(traceHistory));
    }
  }, [traceHistory]);

  // Telemetry Metrics (Cumulative)
  const [cumulativeCost, setCumulativeCost] = useState(0.0);
  // T43 (design D5 a; F-180): every turn's `timing` off the response — null
  // for a turn that returned none — aggregated by the pure module for the
  // stats drawer (summed, never estimated), and the served model pair the
  // router reported on the last turn. The cumulative token count and the
  // last latency this used to keep were the same numbers by another route
  // (the telemetry), one of them split 75 / 25 by assumption in the drawer.
  const [sessionTimings, setSessionTimings] = useState([]);
  const [lastRouterModel, setLastRouterModel] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // Machinery PR 1 (design §4, §5; D6, D7): the live bubble of a streaming code turn, the per-turn thinking switch (on
  // by default) and the scenario step a code turn belongs to (set by the scenario panel; null for a free-form turn).
  const [liveTurn, setLiveTurn] = useState(null);
  const [thinkingMode, setThinkingMode] = useState("on");
  const [activeScenarioStep, setActiveScenarioStep] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [progress, setProgress] = useState(0);

  // Reset System State
  // Session reset clears CHAT state only (ticket T21, F-15 / E38). It no longer
  // drops the Weaviate collection — that is the Standards Drawer's Tidy Up,
  // behind a typed confirmation — and it leaves the file tray alone. The tray
  // is per-page-load memory appended by the File Browser (it was never
  // persisted; the old nxs_loadedFiles removal here was dead code), so
  // emptying it would only show 0 files over a store this handler no longer
  // touches.
  // E1 (CA-007, 2026-10-06): the two setters T43 removed with their state (setCumulativeTokens, setLastLatency)
  // threw here and the resets after them never ran; the SQL-era states went with E5.
  const handleResetState = () => {
    setChatHistory([
      {
        sender: "ai",
        text: "Welcome to NexCODE. Let's write some code!",
        timestamp: formatTime()
      }
    ]);
    if (typeof window !== "undefined") {
      localStorage.removeItem("nxs_chatHistory");
      localStorage.removeItem("nxs_traceHistory");
    }
    setTraceHistory([]);
    setChatInput("");
    setCumulativeCost(0.0);
    setProgress(0);
    setIsAnalyzing(false);
    setStatusMessage("");
    setIngestionProgress(null);
  };

  const handleGenerateQuery = async (e) => {
    if (e) e.preventDefault();
    const queryToRun = chatInput;
    if (!queryToRun.trim() || isAnalyzing) return;

    const userMessage = queryToRun;

    // T15 (design D2, D10): ONE routing rule, shared with the server. The
    // page only picks the endpoint — the IDE bridge for a code turn (the
    // default for this assistant, or /code), the chat route otherwise; the
    // server's evaluation of the same rule is the one reported.
    const route = routeTurn({ message: userMessage });
    const classification = { cleanMessage: route.cleanMessage, forcedCommand: route.slash ? route.slash.command : null, intent: route.mode === "code" ? "code-generate" : route.mode === "doc" ? "document-qa" : "general-query" };
    const useIDEBridge = route.mode === "code";

    setChatHistory(prev => [...prev, { sender: "user", text: userMessage, timestamp: formatTime() }]);
    setChatInput("");
    setIsAnalyzing(true);
    setProgress(10);

    // Progress bar simulation (ANALYSING -> SCANNING -> GENERATING)
    setStatusMessage(useIDEBridge ? "ANALYSING (IDE)" : "ANALYSING");
    const interval = setInterval(() => {
      setProgress(p => {
        if (p < 40) return p + 10;
        if (p >= 40 && p < 80) {
          setStatusMessage(useIDEBridge ? "ENRICHING CONTEXT" : "SCANNING");
          return p + 5;
        }
        if (p >= 80 && p < 95) {
          setStatusMessage("GENERATING");
          return p + 1;
        }
        return p;
      });
    }, 80);

    const activeEndpointType = useIDEBridge ? codeEndpointType : endpointType;
    const activeUrl = useIDEBridge
      ? (codeEndpointType === "mlis" ? codeMlisUrl : codeEndpointType === "litellm" ? codeLiteLlmUrl : codeOllamaUrl)
      : (endpointType === "mlis" ? mlisUrl : endpointType === "litellm" ? liteLlmUrl : ollamaUrl);
    const activeToken = useIDEBridge
      ? (codeEndpointType === "mlis" ? codeMlisToken : codeEndpointType === "litellm" ? codeLiteLlmToken : codeOllamaToken)
      : (endpointType === "mlis" ? mlisToken : endpointType === "litellm" ? liteLlmToken : ollamaToken);
    const activeModelName = useIDEBridge
      ? (codeEndpointType === "ollama" ? codeOllamaModelName : codeEndpointType === "litellm" ? codeLiteLlmModelName : "nvidia/nemotron-nano-12b-v2-vl")
      : (endpointType === "ollama" ? ollamaModelName : endpointType === "litellm" ? liteLlmModelName : modelName);

    const adminConfigPayload = {
      nimEndpoint: activeUrl,
      nimApiKey: activeToken,
      nimModelName: activeModelName,
      systemPrompt: systemPrompt,
      temperature: temperature,
      maxTokens: maxTokens,
      weaviateUrl: weaviateUrl,
      mlisToken: mlisToken,
      embedApiKey: embedApiKey,
      embedEndpoint: embedEndpointUrl,
      embedModelName: embedModelName,
      rerankEndpointUrl: rerankEndpointUrl,
      rerankModelName: rerankModelName,
      // F-22: the reranker endpoint authorises its own service account, so the
      // chat token 403s against it. Without this the rerank leg silently fell
      // back to a uniform 0.5 for every candidate — ranking by nothing.
      rerankApiKey: rerankApiKey,
      vlmModelName: vlmModelName,
      vlmEndpointUrl: vlmEndpointUrl,
      vlmApiKey: vlmApiKey,
      ragSettings: ragSettings,
      forcedCommand: classification.forcedCommand,
      // T15 (design D7): the model / endpoint PAIRS — one object per agent —
      // so the server selects URL, model and credential together by mode
      // and can never pair one agent's URL with the other's model (E28).
      // The legacy trio above stays for one release (older runners).
      modelProfiles: {
        chat: {
          endpointType,
          url: endpointType === "mlis" ? mlisUrl : endpointType === "litellm" ? liteLlmUrl : ollamaUrl,
          token: endpointType === "mlis" ? mlisToken : endpointType === "litellm" ? liteLlmToken : ollamaToken,
          model: endpointType === "ollama" ? ollamaModelName : endpointType === "litellm" ? liteLlmModelName : modelName,
        },
        code: {
          endpointType: codeEndpointType,
          url: codeEndpointType === "mlis" ? codeMlisUrl : codeEndpointType === "litellm" ? codeLiteLlmUrl : codeOllamaUrl,
          token: codeEndpointType === "mlis" ? codeMlisToken : codeEndpointType === "litellm" ? codeLiteLlmToken : codeOllamaToken,
          model: codeEndpointType === "ollama" ? codeOllamaModelName : codeEndpointType === "litellm" ? codeLiteLlmModelName : "nvidia/nemotron-nano-12b-v2-vl",
        },
      },
    };
    // T15 (design D4, D11): the selected document, if any, as the request's
    // scope (a list — the API accepts several).
    const documentScopeField = documentScopeSelection ? [documentScopeSelection] : null;

    try {
      let data;
      const actualPrompt = classification.cleanMessage || userMessage;
      // T43 (design D4 a): the page's own send → receive clock. The server's
      // wall is on the response; the difference (the network) is shown in the
      // footer's tooltip — no second measurement on the server.
      const sentAtMs = Date.now();

      if (useIDEBridge) {
        // Route through IDE Bridge API (enriches with IDE context)
        // Machinery PR 1 (design §4; D1, D6): every code turn goes to the coding path, streamed; the scenario step and
        // the thinking switch ride the request. /doc and /chat keep the chat route below.
        setLiveTurn(liveTurnReducer(null, { type: "start", thinking: thinkingMode }));
        const response = await fetch("/api/ide-bridge/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: actualPrompt,
            history: chatHistory.slice(-5),
            adminConfig: adminConfigPayload,
            intent: classification.intent,
            documentScope: documentScopeField,
            scenario: activeScenarioStep,
            thinking: thinkingMode,
          })
        });

        clearInterval(interval);
        setProgress(100);

        if (!response.ok) throw new Error(`IDE Bridge error: ${response.status}`);
        data = await readCodingTurn(response, { onEvent: (event) => setLiveTurn((prev) => liveTurnReducer(prev, event)) });
        setLiveTurn(null);
        const clientMs = Date.now() - sentAtMs;

        // T43 (design D5 a): the turn's timing and the served model, for the stats drawer.
        setSessionTimings(prev => [...prev, data.timing || null]);
        setLastRouterModel(data.router && data.router.model ? data.router.model : null);

        // Accumulate usage metrics
        const runCost = data.telemetry?.cost || 0;
        setCumulativeCost(prev => prev + runCost);

        // Build the AI response message with metadata
        const aiMessage = {
          sender: "ai",
          // T36 (design D2): an absent answer is never called a success — the
          // sentence was untrue whenever it appeared (an empty cut, §0b).
          text: data.response || "(the model returned no answer text)",
          timestamp: formatTime(),
          intent: classification.intent,
          bridgeConnected: data.bridgeConnected,
          ideContext: data.ideContext,
          fileOperations: data.fileOperations || [],
          // Machinery PR 1 (design §4): the coding path's own report — scenario step, thinking mode, layers, files.
          coding: data.coding || null,
          retrievalError: data.retrievalError || null,
          // T10/F-34: the typed retrieval outcome, carried VERBATIM so the UI
          // can disclose a degraded turn. Copied, never re-derived: a local
          // flag computed here would be a second source of truth that can
          // disagree with the API and with the model's own prompt banner (T12).
          retrieval: data.retrieval || null,
          isFailure: data.success === false,
          // T15 (design D13): the router's verdict and the T28 fields on the
          // message, so the chips can say what the turn was and its scope.
          router: data.router || null,
          documentScope: data.documentScope || null,
          contextAssembly: data.contextAssembly || null,
          citations: data.citations || null,
          uncitedClaims: data.uncitedClaims || null,
          // T36 (design D1; F-134): the generator's outcome, copied VERBATIM
          // so the chip can disclose a cut answer with the field's own numbers.
          generation: data.generation || null,
          // T43 (design D2 a, D4 a; F-179): the turn's timing VERBATIM and the
          // page's own end-to-end clock; the footer formats them through the
          // pure module and does no arithmetic.
          timing: data.timing || null,
          // T48 (design §2.5, D5): the answer policy VERBATIM — the panel splits a written section off with the pure
          // module's reader and labels it; nothing is re-derived here.
          answerPolicy: data.answerPolicy || null,
          clientMs,
        };

        setChatHistory(prev => [...prev, aiMessage]);

        // Record execution trace for Tracing Drawer
        if (data.traces) {
          setTraceHistory(prev => [
            ...prev,
            {
              turnId: `turn-${Date.now()}`,
              turnNumber: prev.length + 1,
              userPrompt: userMessage,
              timestamp: new Date().toISOString(),
              // T43 (design §2.5): the turn's clock for the drawer's header.
              timing: data.timing || null,
              // T48 (design §2.4): the answer policy of the turn, beside its clock.
              answerPolicy: data.answerPolicy || null,
              traces: data.traces
            }
          ]);
        }

      } else {
        // Route through standard Chat API (no IDE context)
        // S4 (the owner's S4-D1 (c) of 2026-10-12): a demo's doc step may set the lookup scope of its one question.
        const docStep = activeScenarioStep && activeScenarioStep.mode === "doc" ? activeScenarioStep : null;
        const stepScope = docStep && docStep.chat && docStep.chat.lookupScope ? docStep.chat.lookupScope : null;
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: actualPrompt,
            history: chatHistory.slice(-5),
            adminConfig: stepScope ? { ...adminConfigPayload, ragSettings: { ...(ragSettings || {}), lookupScope: stepScope } } : adminConfigPayload,
            documentScope: documentScopeField,
          })
        });

        clearInterval(interval);
        setProgress(100);

        if (!response.ok) throw new Error(`Execution error: ${response.status}`);
        data = await response.json();
        const clientMs = Date.now() - sentAtMs;
        // S4: the document chat answered a demo's doc step: the step bar's gate reads the run log, so say so there.
        if (docStep) {
          fetch("/api/ide-bridge/scenarios", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "doc-turn", scenarioId: docStep.id, stepId: docStep.stepId, success: data.success !== false && Boolean(data.explanation), prompt: userMessage, citations: Array.isArray(data.citations) ? data.citations.length : 0, clientMs, model: data.router && data.router.model ? data.router.model : null, tokens: data.timing && data.timing.tokens ? data.timing.tokens : null }),
          }).catch(() => {});
        } else {
          // Polish Phase 2 (PL-D8 (a)): a document chat answer outside a doc step is logged too, with the active demo
          // when there is one, so the usage figures count every answer.
          fetch("/api/ide-bridge/scenarios", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "chat-turn", scenarioId: activeDemoId || undefined, success: data.success !== false && Boolean(data.explanation), prompt: userMessage, citations: Array.isArray(data.citations) ? data.citations.length : 0, clientMs, model: data.router && data.router.model ? data.router.model : null, tokens: data.timing && data.timing.tokens ? data.timing.tokens : null }),
          }).catch(() => {});
        }

        // T12: turn-level failures are surfaced on the message itself (ChatPanel's error styling). The SQL-era
        // turn states that were set here (E5, CA-015) had no reader once the IDE replaced the chart stage; the
        // route's sql_query / target_view / rows fields stay on the wire (frozen route) and are ignored here.
        // T43 (design D5 a): the turn's timing and the served model, for the stats drawer.
        setSessionTimings(prev => [...prev, data.timing || null]);
        setLastRouterModel(data.router && data.router.model ? data.router.model : null);

        const runCost = data.telemetry?.cost || 0;
        setCumulativeCost(prev => prev + runCost);

        setChatHistory(prev => [
          ...prev,
          {
            sender: "ai",
            // T36 (design D2): an absent answer is never called a success.
            text: data.explanation || "(the model returned no answer text)",
            timestamp: formatTime(),
            // T12: an answer given without grounding, or no answer at all, is
            // marked as such rather than rendered identically to a good one.
            retrievalError: data.retrievalError || null,
            // T10/F-34: a turn whose passages were never relevance-ranked used
            // to render identically to a healthy one. The model, the trace
            // drawer and API consumers were all told; the person reading the
            // answer was not — and the owner's ruling that unscored passages
            // may pass the relevance floor is conditional on exactly this
            // disclosure existing.
            retrieval: data.retrieval || null,
            isFailure: data.success === false,
            // T14: source chips + fabrication flag rendered by ChatPanel.
            citations: data.citations || null,
            uncitedClaims: data.uncitedClaims || null,
            // T15 (design D13; the T28 fields never reached the message before):
            router: data.router || null,
            documentScope: data.documentScope || null,
            contextAssembly: data.contextAssembly || null,
            // T36 (design D1; F-134): the generator's outcome, verbatim.
            generation: data.generation || null,
            // T43 (design D2 a, D4 a; F-179): the turn's timing VERBATIM and
            // the page's own end-to-end clock, for the footer.
            timing: data.timing || null,
            // T48 (design §2.5, D5): the answer policy VERBATIM, for the section's block.
            answerPolicy: data.answerPolicy || null,
            clientMs,
          }
        ]);

        // Record execution trace for Tracing Drawer
        if (data.traces) {
          setTraceHistory(prev => [
            ...prev,
            {
              turnId: `turn-${Date.now()}`,
              turnNumber: prev.length + 1,
              userPrompt: userMessage,
              timestamp: new Date().toISOString(),
              // T43 (design §2.5): the turn's clock for the drawer's header.
              timing: data.timing || null,
              // T48 (design §2.4): the answer policy of the turn, beside its clock.
              answerPolicy: data.answerPolicy || null,
              traces: data.traces
            }
          ]);
        }
      }
    } catch (err) {
      clearInterval(interval);
      setProgress(0);
      setChatHistory(prev => [
        ...prev,
        {
          sender: "ai",
          // E1 (CA-019): there is no fallback — say what happened and that nothing was generated.
          text: `The request failed: ${err.message}. Nothing was generated.`,
          timestamp: formatTime()
        }
      ]);
    } finally {
      setIsAnalyzing(false);
      setStatusMessage("");
      setLiveTurn(null);
      setTimeout(() => setProgress(0), 500);
    }
  };

  // Handler for applying file operations from chat messages
  const handleApplyFileOperation = async (operation) => {
    try {
      const response = await fetch("/api/ide-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applyOperation: operation })
      });
      if (response.ok) {
        const result = await response.json();
        // E6 (CA-012, CA-019): "open in the IDE" only when the bridge said so; the workspace write alone is
        // reported as a write, with the bridge named as offline.
        const opened = Boolean(result?.applied?.extensionResult?.success);
        setWorkspaceTick((n) => n + 1);
        setChatHistory(prev => [
          ...prev,
          {
            sender: "ai",
            text: opened
              ? `✅ Applied changes to \`${operation.path}\` — the file is now open in the IDE.`
              : `✅ Wrote \`${operation.path}\` to the workspace; the IDE did not open it (bridge offline).`,
            timestamp: formatTime()
          }
        ]);
        return result;
      }
      // E2 (CA-001): a refused path (HTTP 400) or any other failure is reported, never silently dropped.
      const failure = await response.json().catch(() => null);
      setChatHistory(prev => [
        ...prev,
        {
          sender: "ai",
          text: `❌ Could not apply changes to \`${operation.path}\`: ${failure?.error || `HTTP ${response.status}`}`,
          timestamp: formatTime()
        }
      ]);
      return failure;
    } catch (err) {
      console.error("[Apply] Failed:", err);
      setChatHistory(prev => [
        ...prev,
        {
          sender: "ai",
          text: `❌ Failed to apply changes to \`${operation.path}\`: ${err.message}`,
          timestamp: formatTime()
        }
      ]);
    }
  };

  // After a demo is selected (the Demo panel's card, or the selection screen): the chat is cleared, the demo becomes the
  // active one, the panels close and the chat gets the Select note that names the ticket, the files and the first step.
  const demoSelected = (scenario, result) => {
    handleResetState();
    setActiveScenarioStep(null);
    setActiveDemoId(scenario.id);
    setIsDemoOpen(false);
    setIsDemoSelectOpen(false);
    const first = result && result.progress && Array.isArray(result.progress.steps) ? result.progress.steps.find((st) => st.status === "ready") : null;
    setChatHistory((prev) => [
      ...prev,
      {
        sender: "ai",
        text: `🎬 ${scenario.id.toUpperCase()} · ${scenario.title}: ${scenario.ticket.id} and its files are open in the IDE.${result && result.tests && result.tests.ran ? ` The tests ran once: ${result.tests.summary}, ${result.tests.passed ? "so the reported fault does not reproduce" : "as the ticket reports"}; the output is in the IDE's NexCODE Tests panel.` : ""}${first ? ` Next: ${first.title}, from the step bar.` : ""}`,
        timestamp: formatTime(),
      },
    ]);
  };

  // Presenter panels (design §6): what a finished answer's chips and the step bar call to open the Demo panel. The chat
  // panel is pinned by the frozen suites, so the chips reach the panel through the context, never through a new prop.
  const presenter = {
    demoOpen: isDemoOpen,
    openDemoPanel: (section = "overview", scenarioId = null) => {
      setDemoRequest({ section, scenarioId: scenarioId || activeDemoId, passages: [], nonce: Date.now() });
      setIsDocsOpen(false);
      setIsResultsOpen(false);
      setIsDemoSelectOpen(false);
      setIsDemoOpen(true);
    },
    openPassages: ({ passages, scenario } = {}) => {
      setDemoRequest({ section: "documents", scenarioId: (scenario && scenario.id) || activeDemoId, passages: Array.isArray(passages) ? passages : [], nonce: Date.now() });
      setIsDocsOpen(false);
      setIsResultsOpen(false);
      setIsDemoSelectOpen(false);
      setIsDemoOpen(true);
    },
    closeDemoPanel: () => setIsDemoOpen(false),
    // PR B (D2): the Results panel opens only on the presenter's click (the sidebar, NEXT after Record, the record chip).
    // S4-D2 (a): the closer opens another demo's record, with every demo's records listed (scope "all").
    openResults: ({ recordId = null, scenarioId = null, scope = null } = {}) => {
      setResultsRequest({ recordId, scenarioId: scenarioId || activeDemoId, scope: scope === "all" ? "all" : null, nonce: Date.now() });
      setIsDemoOpen(false);
      setIsDocsOpen(false);
      setIsResultsOpen(true);
    },
    openDocuments: () => {
      setIsDemoOpen(false);
      setIsResultsOpen(false);
      setIsDocsOpen(true);
    },
  };

  return (
    <PresenterProvider value={presenter}>
      <Sidebar
        chatOpen={chatOpen}
        setChatOpen={setChatOpen}
        ideOpen={ideOpen}
        setIdeOpen={setIdeOpen}
        isDemoOpen={isDemoOpen}
        setIsDemoOpen={setIsDemoOpen}
        isDemoSelectOpen={isDemoSelectOpen}
        setIsDemoSelectOpen={setIsDemoSelectOpen}
        isDocsOpen={isDocsOpen}
        setIsDocsOpen={setIsDocsOpen}
        isResultsOpen={isResultsOpen}
        setIsResultsOpen={(v) => {
          if (v) setResultsRequest({ recordId: null, scenarioId: activeDemoId, nonce: Date.now() });
          setIsResultsOpen(v);
        }}
        isStandardsOpen={isStandardsOpen}
        setIsStandardsOpen={setIsStandardsOpen}
        isFileBrowserOpen={isFileBrowserOpen}
        setIsFileBrowserOpen={setIsFileBrowserOpen}
        isStatsOpen={isStatsOpen}
        setIsStatsOpen={setIsStatsOpen}
        isTracingOpen={isTracingOpen}
        setIsTracingOpen={setIsTracingOpen}
        isAdminOpen={isAdminOpen}
        setIsAdminOpen={setIsAdminOpen}
        handleResetState={handleResetState}
        isResetOpen={isResetOpen}
        setIsResetOpen={setIsResetOpen}
      />
      
      <div className="pl-20 w-full h-[calc(100vh-80px)] overflow-hidden">
        <div className="w-full h-full px-6 py-4 flex flex-col gap-5 min-h-0">
          
          <div className="grid grid-cols-12 gap-5 items-stretch flex-1 min-h-0">
            {chatOpen && (
              <div className={`${
                ideOpen 
                  ? "col-span-12 md:col-span-5 lg:col-span-4" 
                  : "col-span-12 md:col-span-12 lg:col-span-12"
              } flex flex-col gap-5 h-full min-h-0`}>
                <StepBar
                  activeDemoId={activeDemoId}
                  activeStep={activeScenarioStep}
                  onUseStep={(scenario, step, opts = {}) => {
                    // Presenter flow: a repair turn (the tests failed) carries the flag; its prompt is the step's repair prompt.
                    const repair = Boolean(opts.repair && step.repair);
                    setActiveScenarioStep({ id: scenario.id, stepId: step.id, ...(repair ? { repair: true } : {}), ...(step.mode === "doc" ? { mode: "doc", chat: step.chat || null } : {}) });
                    setChatInput((repair ? step.repair.prompt : step.prompt) || "");
                  }}
                  onClearStep={() => setActiveScenarioStep(null)}
                  onRecordTrace={(turn) => setTraceHistory((prev) => [...prev, { ...turn, turnNumber: prev.length + 1 }])}
                  onNote={(text, extra) => setChatHistory((prev) => [...prev, { sender: "ai", text, timestamp: formatTime(), ...(extra && typeof extra === "object" ? extra : {}) }])}
                  onResetChat={handleResetState}
                  isAnalyzing={isAnalyzing}
                  workspaceTick={workspaceTick}
                />
                <ChatPanel
                  chatHistory={chatHistory}
                  chatInput={chatInput}
                  setChatInput={setChatInput}
                  isAnalyzing={isAnalyzing}
                  statusMessage={statusMessage}
                  progress={progress}
                  handleGenerateQuery={handleGenerateQuery}
                  onApplyFileOperation={handleApplyFileOperation}
                  storeDocuments={storeDocuments}
                  documentScopeSelection={documentScopeSelection}
                  setDocumentScopeSelection={setDocumentScopeSelection}
                  liveTurn={liveTurn}
                  thinkingMode={thinkingMode}
                  setThinkingMode={setThinkingMode}
                />
              </div>
            )}

            {/* Session 88 (bridge fix): the IDE column stays MOUNTED and is only hidden while the panel is closed.
                Unmounting it on every toggle opened a new code-server window each time, and the old window's
                extension host kept the bridge port for up to five minutes (evidence/session-88-bridge-check). */}
            <div className={
              ideOpen
                ? `${chatOpen ? "col-span-12 md:col-span-7 lg:col-span-8" : "col-span-12 md:col-span-12 lg:col-span-12"} flex flex-col gap-5 h-full min-h-0`
                : "hidden"
            }>
              <VisualStage />
            </div>

            {!chatOpen && !ideOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="col-span-12 flex flex-col items-center justify-center h-full text-center p-8 border border-white/5 rounded-3xl bg-[#0D0D0D]/60 backdrop-blur-xl"
              >
                <div className="w-16 h-16 rounded-2xl bg-brand-vivid/10 border border-brand-vivid/20 flex items-center justify-center mb-4 text-brand-vivid shadow-[0_0_20px_rgba(242,86,29,0.1)]">
                  <RiCodeBoxLine size={32} />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Workspace Minimised</h3>
                <p className="text-sm text-neutrals-medium max-w-md">
                  Both the Chat Assistant and IDE panels are currently hidden. Toggle them in the sidebar to resume your work.
                </p>
              </motion.div>
            )}
          </div>

        </div>
      </div>

      {/* Slide-out Overlay Sheets */}
      <AnimatePresence>
        {isAdminOpen && (
          <AdminDrawer
            isOpen={isAdminOpen}
            onClose={() => setIsAdminOpen(false)}
            nimEndpoint={nimEndpoint}
            setNimEndpoint={setNimEndpoint}
            nimApiKey={nimApiKey}
            setNimApiKey={setNimApiKey}
            systemPrompt={systemPrompt}
            setSystemPrompt={setSystemPrompt}
            weaviateUrl={weaviateUrl}
            setWeaviateUrl={setWeaviateUrl}
            temperature={temperature}
            setTemperature={setTemperature}
            maxTokens={maxTokens}
            setMaxTokens={setMaxTokens}
            endpointType={endpointType}
            setEndpointType={setEndpointType}
            mlisUrl={mlisUrl}
            setMlisUrl={setMlisUrl}
            mlisToken={mlisToken}
            setMlisToken={setMlisToken}
            liteLlmUrl={liteLlmUrl}
            setLiteLlmUrl={setLiteLlmUrl}
            liteLlmToken={liteLlmToken}
            setLiteLlmToken={setLiteLlmToken}
            ollamaUrl={ollamaUrl}
            setOllamaUrl={setOllamaUrl}
            ollamaToken={ollamaToken}
            setOllamaToken={setOllamaToken}
            setChatHistory={setChatHistory}
            ollamaModelName={ollamaModelName}
            setOllamaModelName={setOllamaModelName}
            liteLlmModelName={liteLlmModelName}
            setLiteLlmModelName={setLiteLlmModelName}

            // Code Agent Model connection states
            codeEndpointType={codeEndpointType}
            setCodeEndpointType={setCodeEndpointType}
            codeMlisUrl={codeMlisUrl}
            setCodeMlisUrl={setCodeMlisUrl}
            codeMlisToken={codeMlisToken}
            setCodeMlisToken={setCodeMlisToken}
            codeLiteLlmUrl={codeLiteLlmUrl}
            setCodeLiteLlmUrl={setCodeLiteLlmUrl}
            codeLiteLlmToken={codeLiteLlmToken}
            setCodeLiteLlmToken={setCodeLiteLlmToken}
            codeOllamaUrl={codeOllamaUrl}
            setCodeOllamaUrl={setCodeOllamaUrl}
            codeOllamaToken={codeOllamaToken}
            setCodeOllamaToken={setCodeOllamaToken}
            codeOllamaModelName={codeOllamaModelName}
            setCodeOllamaModelName={setCodeOllamaModelName}
            codeLiteLlmModelName={codeLiteLlmModelName}
            setCodeLiteLlmModelName={setCodeLiteLlmModelName}

            // RAG Agent Model connection states
            embedModelName={embedModelName}
            setEmbedModelName={setEmbedModelName}
            embedEndpointUrl={embedEndpointUrl}
            setEmbedEndpointUrl={setEmbedEndpointUrl}
            embedApiKey={embedApiKey}
            setEmbedApiKey={setEmbedApiKey}
            rerankModelName={rerankModelName}
            setRerankModelName={setRerankModelName}
            rerankEndpointUrl={rerankEndpointUrl}
            setRerankEndpointUrl={setRerankEndpointUrl}
            rerankApiKey={rerankApiKey}
            setRerankApiKey={setRerankApiKey}
            vlmModelName={vlmModelName}
            setVlmModelName={setVlmModelName}
            vlmEndpointUrl={vlmEndpointUrl}
            setVlmEndpointUrl={setVlmEndpointUrl}
            vlmApiKey={vlmApiKey}
            setVlmApiKey={setVlmApiKey}
            ragSettings={ragSettings}
            setRagSettings={setRagSettings}

            // Visibility Toggles
            chatAgentToggle={chatAgentToggle}
            setChatAgentToggle={setChatAgentToggle}
            codeAgentToggle={codeAgentToggle}
            setCodeAgentToggle={setCodeAgentToggle}
            ragAgentToggle={ragAgentToggle}
            setRagAgentToggle={setRagAgentToggle}
          />
        )}

        {isStatsOpen && (
          <StatsDrawer
            isOpen={isStatsOpen}
            onClose={() => setIsStatsOpen(false)}
            cumulativeCost={cumulativeCost}
            session={aggregateSessionTiming(sessionTimings)}
            servedModel={lastRouterModel}
            activeDemoId={activeDemoId}
            refreshKey={sessionTimings.length}
          />
        )}

        {isTracingOpen && (
          <TracingDrawer
            isOpen={isTracingOpen}
            onClose={() => setIsTracingOpen(false)}
            traceHistory={traceHistory}
          />
        )}

        {isStandardsOpen && (
          <StandardsDrawer
            isOpen={isStandardsOpen}
            onClose={() => { setIsStandardsOpen(false); refreshStoreDocuments(); }}
            loadedFiles={loadedFiles}
            setLoadedFiles={setLoadedFiles}
            onPreviewDocument={(name) => setDocumentScopeSelection(name)}
            ingestionProgress={ingestionProgress}
            weaviateUrl={weaviateUrl}
            token={mlisToken}
            weaviateCollection={ragSettings?.weaviateCollection || "RAGChunk"}
            schemaVersion={ragSettings?.schemaVersion}
          />
        )}

        {isFileBrowserOpen && (
          <FileBrowserDrawer
            isOpen={isFileBrowserOpen}
            onClose={() => setIsFileBrowserOpen(false)}
            loadedFiles={loadedFiles}
            setLoadedFiles={setLoadedFiles}
            triggerIngestion={triggerIngestion}
          />
        )}
      </AnimatePresence>

      {/* Floating Ingestion Progress Toast */}
      {ingestionProgress && (
        <div className="fixed top-6 right-6 z-[999] w-96 p-6 rounded-2xl border border-[#A855F7]/40 bg-[#0F0F10]/98 backdrop-blur-2xl shadow-[0_12px_48px_rgba(0,0,0,0.8)] flex flex-col gap-3.5 transition-all text-white">
          <div className="flex justify-between items-center">
            <span className="text-xs font-sans font-bold uppercase tracking-wider text-purple-400 flex items-center gap-2">
              {ingestionProgress.status === "processing" && (
                <RiLoader4Line size={16} className="animate-spin text-purple-500 animate-pulse" />
              )}
              {ingestionProgress.status === "processing"
                ? (ingestionProgress.cancelled ? "Cancelling..." : "Indexing Vector DB...")
                : ingestionProgress.status === "completed"
                ? "Ingestion Success"
                : ingestionProgress.status === "partial"
                ? "Ingestion Partial"
                : ingestionProgress.status === "cancelled"
                ? "Ingestion Cancelled"
                : ingestionProgress.status === "interrupted"
                ? "Ingestion Interrupted"
                : "Ingestion Failed"}
            </span>
            <span className="text-sm font-mono font-black text-[#A855F7] tracking-tight">
              {ingestionProgress.progressPercent || 0}%
            </span>
          </div>
          
          {ingestionProgress.status === "processing" && (
            <div className="text-xs font-sans text-neutrals-light leading-relaxed truncate">
              Processing: <span className="text-white font-mono font-semibold">{ingestionProgress.currentFile}</span>
            </div>
          )}

          {(ingestionProgress.status === "error" || ingestionProgress.status === "partial") && ingestionProgress.error && (
            <div className={`text-xs font-sans leading-relaxed whitespace-pre-wrap font-semibold ${ingestionProgress.status === "error" ? "text-red-400" : "text-amber-300"}`}>
              {ingestionProgress.error}
            </div>
          )}

          {/* T07 (F-49 / E16, design D9): per-file outcomes with their reasons. */}
          {Array.isArray(ingestionProgress.fileResults) && ingestionProgress.fileResults.length > 0 && (
            <ul className="flex flex-col gap-1 text-[10px] font-mono text-neutrals-light max-h-32 overflow-y-auto" data-testid="ingest-file-results">
              {ingestionProgress.fileResults.map((f) => (
                <li key={f.filePath || f.fileName} className="flex justify-between gap-2">
                  <span className="truncate" title={f.filePath || f.fileName}>{f.fileName}</span>
                  <span className={`shrink-0 ${f.status === "indexed" ? "text-emerald-300" : f.status === "skipped" ? "text-neutrals-medium" : f.status === "failed" || f.status === "partial" || f.status === "empty" || f.status === "cancelled" ? "text-rose-300" : "text-purple-300"}`} title={f.error || f.supersedeError || f.reason || ""}>
                    {f.status}
                    {f.status === "indexed" && f.counts ? ` · ${f.counts.chunksInserted} chunks` : ""}
                    {f.status === "partial" && f.counts ? ` · ${f.counts.chunksInserted}/${f.counts.chunksEmitted}` : ""}
                    {/* T24 (design D13) / T29 / T31 (design D7): the figure outcomes, when the parse counted them — one wording for both views */}
                    {figureSuffix(f)}
                    {f.status === "skipped" && f.reason ? ` · ${f.reason}` : ""}
                    {(f.status === "failed" || f.status === "empty") && (f.reason || f.error) ? ` · ${(f.reason || f.error).slice(0, 80)}` : ""}
                    {f.supersedeError ? " · previous versions not removed" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Progress Bar */}
          <div className="w-full h-2.5 bg-white/5 rounded-full overflow-hidden shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
            <div
              className={`h-full transition-all duration-300 ${ingestionProgress.status === 'error' ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]' : 'bg-gradient-to-r from-purple-500 to-[#A855F7] shadow-[0_0_12px_rgba(168,85,247,0.5)]'}`}
              style={{ width: `${ingestionProgress.progressPercent || 0}%` }}
            />
          </div>

          <div className="flex justify-between items-center text-xs text-neutrals-medium font-mono mt-1">
            <div className="flex gap-4">
              <span>Chunks: <strong className="text-white font-mono font-bold text-xs">{ingestionProgress.chunksIndexed || 0}</strong></span>
              {ingestionProgress.status === "processing" && (
                <span>ETA: <strong className="text-white font-mono font-bold text-xs">{ingestionProgress.etaSeconds || 0}s</strong></span>
              )}
            </div>
            {ingestionProgress.status === "processing" && (
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await fetch("/api/ingest/cancel", { method: "POST" });
                  } catch (err) {
                    console.error("Cancel failed:", err);
                  }
                }}
                className="px-3.5 py-1.5 rounded-full text-[10px] font-sans font-bold border border-rose-500/40 bg-rose-500/10 text-rose-300 shadow-[0_2px_8px_rgba(244,63,94,0.2),_inset_0_1px_1px_rgba(255,255,255,0.05)] hover:bg-rose-500/20 active:scale-95 transition-all cursor-pointer border-none outline-none"
                disabled={Boolean(ingestionProgress.cancelled)}
              >
                {ingestionProgress.cancelled ? "Cancelling…" : "Cancel"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* The two-level reset (design §13; the owner's D1-D4 of 2026-10-07): "Clear the chat" is what Session Reset always
          did; "Reset the demo environment" rebuilds the workspace from the seed and clears the IDE on the server, then
          returns every presenter control here to its starting state. The documents, the store and the settings are
          never touched. */}
      <ResetMenu
        open={isResetOpen}
        onClose={() => setIsResetOpen(false)}
        onClearChat={() => {
          handleResetState();
          setIsResetOpen(false);
        }}
        onEnvironmentReset={() => {
          handleResetState();
          setActiveScenarioStep(null);
          setActiveDemoId(null);
          setDemoRequest(null);
          setIsDemoOpen(false);
          setIsDocsOpen(false);
          setIsResultsOpen(false);
          setThinkingMode("on");
          setDocumentScopeSelection("");
          setLiveTurn(null);
          setWorkspaceTick((n) => n + 1);
          setIsDemoSelectOpen(false);
        }}
      />

      {/* PR B (the owner's D1-D7 of 2026-10-07): the Results panel (the evidence record as a report, the code change, the
          record as filed; any other Markdown or JSON output) and the Documents panel (every document in play for the
          demo; its footer opens the old ingest tray, unchanged). */}
      <ResultsPanel open={isResultsOpen} request={resultsRequest} activeDemoId={activeDemoId} onClose={() => setIsResultsOpen(false)} />
      <DocumentsPanel
        open={isDocsOpen}
        activeDemoId={activeDemoId}
        storeSettings={{ weaviateUrl, mlisToken, ragSettings }}
        onClose={() => setIsDocsOpen(false)}
        onStoreAdmin={() => {
          setIsDocsOpen(false);
          setIsStandardsOpen(true);
        }}
      />

      {/* Presenter panels (design §2, §3): the Demo panel over the workbench. Select demo resets and starts the demo on
          the server; here it clears the chat, drops any active step, follows the demo in the step bar and closes. The
          technical block is read live from the admin settings, never from text in the card. */}
      <DemoPanel
        open={isDemoOpen}
        request={demoRequest}
        activeDemoId={activeDemoId}
        storeSettings={{ weaviateUrl, mlisToken, ragSettings }}
        technical={{
          codeModel: codeEndpointType === "ollama" ? codeOllamaModelName : codeEndpointType === "litellm" ? codeLiteLlmModelName : "nvidia/nemotron-nano-12b-v2-vl",
          endpointType: codeEndpointType,
          thinkingMode,
          embedModel: embedModelName,
          rerankModel: rerankModelName,
        }}
        onClose={() => setIsDemoOpen(false)}
        onChooseDemo={() => {
          setIsDemoOpen(false);
          setIsDemoSelectOpen(true);
        }}
        onRecordTrace={(turn) => setTraceHistory((prev) => [...prev, { ...turn, turnNumber: prev.length + 1 }])}
        onSelected={demoSelected}
      />

      {/* Polish (the owner's PL-D1 to PL-D6 of 2026-10-14): the demo selection screen the Demo icon opens. Select sets the
          demo up and returns to the app; Details opens the Demo panel on that demo; free flow clears the active demo. */}
      <DemoSelect
        open={isDemoSelectOpen}
        activeDemoId={activeDemoId}
        onClose={() => setIsDemoSelectOpen(false)}
        onOpenIde={() => setIdeOpen(true)}
        onRecordTrace={(turn) => setTraceHistory((prev) => [...prev, { ...turn, turnNumber: prev.length + 1 }])}
        onSelected={demoSelected}
        onDetails={(scenario) => presenter.openDemoPanel("overview", scenario.id)}
        onFreeFlow={() => {
          setIsDemoSelectOpen(false);
          setActiveScenarioStep(null);
          setActiveDemoId(null);
          setDemoRequest(null);
        }}
      />

    </PresenterProvider>
  );
}
