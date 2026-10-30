"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import PricingPanel from "@/components/PricingPanel";
import ModelCheck from "@/components/ModelCheck";
// T17: the settings vocabulary and the schema-line functions come from the
// ONE module the server resolves through (design D1, D7, D9) — no literal
// here can disagree with what the server reads.
import { RETRIEVAL_DEFAULTS, DUPLICATE_POLICIES, DETAIL_PASS_MODES, OCR_MODES, resolveSchemaVersion, collectionNameForVersion } from "@/lib/rag/config";
import {
  RiCloseLine,
  RiCoinLine,
  RiSettings4Line,
  RiSaveLine,
  RiCpuLine,
  RiCheckLine,
  RiLoader4Line,
  RiPlayLine,
  RiDatabase2Line,
  RiChatAi4Line,
  RiCodeBoxLine,
  RiBookletLine,
  RiDatabaseLine,
  RiInformationLine
} from "@remixicon/react";

const DEFAULT_LITELLM_MODELS = [
  "qwen3-coder:30b",
  "qwen3.6:27b",
  "gemma4:26b"
];

function InfoTooltip({ text, id, openTooltip, setOpenTooltip }) {
  const isOpen = openTooltip === id;
  return (
    <div className="relative inline-flex items-center shrink-0">
      <span 
        className="flex items-center cursor-pointer text-neutrals-medium hover:text-white select-none ml-1"
        onClick={(e) => { 
          e.stopPropagation(); 
          setOpenTooltip(isOpen ? null : id); 
        }}
      >
        <RiInformationLine size={11} />
      </span>
      {isOpen && (
        <span 
          className="absolute bottom-6 left-0 z-[150] bg-[#121212] border border-white/15 rounded-xl p-3 text-[11px] text-white normal-case font-normal tracking-normal leading-relaxed w-72 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {text}
        </span>
      )}
    </div>
  );
}

export default function AdminDrawer({
  isOpen,
  onClose,
  nimEndpoint,
  setNimEndpoint,
  nimApiKey,
  setNimApiKey,
  systemPrompt,
  setSystemPrompt,
  weaviateUrl,
  setWeaviateUrl,
  temperature,
  setTemperature,
  maxTokens,
  setMaxTokens,
  endpointType,
  setEndpointType,
  mlisUrl,
  setMlisUrl,
  mlisToken,
  setMlisToken,
  liteLlmUrl,
  setLiteLlmUrl,
  liteLlmToken,
  setLiteLlmToken,
  ollamaUrl,
  setOllamaUrl,
  ollamaToken,
  setOllamaToken,
  ollamaModelName,
  setOllamaModelName,
  liteLlmModelName,
  setLiteLlmModelName,

  // Code Agent props
  codeEndpointType,
  setCodeEndpointType,
  codeMlisUrl,
  setCodeMlisUrl,
  codeMlisToken,
  setCodeMlisToken,
  codeLiteLlmUrl,
  setCodeLiteLlmUrl,
  codeLiteLlmToken,
  setCodeLiteLlmToken,
  codeOllamaUrl,
  setCodeOllamaUrl,
  codeOllamaToken,
  setCodeOllamaToken,
  codeOllamaModelName,
  setCodeOllamaModelName,
  codeLiteLlmModelName,
  setCodeLiteLlmModelName,

  // RAG Agent props
  embedModelName,
  setEmbedModelName,
  embedEndpointUrl,
  setEmbedEndpointUrl,
  embedApiKey,
  setEmbedApiKey,
  rerankModelName,
  setRerankModelName,
  rerankEndpointUrl,
  setRerankEndpointUrl,
  rerankApiKey,
  setRerankApiKey,
  vlmModelName,
  setVlmModelName,
  vlmEndpointUrl,
  setVlmEndpointUrl,
  vlmApiKey,
  setVlmApiKey,
  ragSettings,
  setRagSettings,

  // Visibility toggles
  chatAgentToggle,
  setChatAgentToggle,
  codeAgentToggle,
  setCodeAgentToggle,
  ragAgentToggle,
  setRagAgentToggle,
  // D31: called after a save that changed the embedding model or endpoint; the page re-indexes the store.
  onEmbeddingChanged,
  indexedDocumentCount = 0,
}) {
  // Tabs visibility states and active tab selection state
  const [activeTab, setActiveTab] = useState("chat");
  const [showReindexNotice, setShowReindexNotice] = useState(false);

  // Local form states (uncommitted until clicking Save)
  const [localEndpointType, setLocalEndpointType] = useState("litellm");
  const [localMlisUrl, setLocalMlisUrl] = useState(mlisUrl);
  const [localMlisToken, setLocalMlisToken] = useState(mlisToken);
  const [localLiteLlmUrl, setLocalLiteLlmUrl] = useState(liteLlmUrl);
  const [localLiteLlmToken, setLocalLiteLlmToken] = useState(liteLlmToken);
  const [localOllamaUrl, setLocalOllamaUrl] = useState(ollamaUrl);
  const [localOllamaToken, setLocalOllamaToken] = useState(ollamaToken);

  const [localOllamaModelName, setLocalOllamaModelName] = useState(ollamaModelName);
  const [localLiteLlmModelName, setLocalLiteLlmModelName] = useState(liteLlmModelName);

  // Local states for Code Agent
  const [localCodeEndpointType, setLocalCodeEndpointType] = useState("litellm");
  const [localCodeMlisUrl, setLocalCodeMlisUrl] = useState(codeMlisUrl);
  const [localCodeMlisToken, setLocalCodeMlisToken] = useState(codeMlisToken);
  const [localCodeLiteLlmUrl, setLocalCodeLiteLlmUrl] = useState(codeLiteLlmUrl);
  const [localCodeLiteLlmToken, setLocalCodeLiteLlmToken] = useState(codeLiteLlmToken);
  const [localCodeOllamaUrl, setLocalCodeOllamaUrl] = useState(codeOllamaUrl);
  const [localCodeOllamaToken, setLocalCodeOllamaToken] = useState(codeOllamaToken);
  const [localCodeOllamaModelName, setLocalCodeOllamaModelName] = useState(codeOllamaModelName);
  const [localCodeLiteLlmModelName, setLocalCodeLiteLlmModelName] = useState(codeLiteLlmModelName);

  // Local states for RAG Agent
  const [localEmbedModelName, setLocalEmbedModelName] = useState(embedModelName);
  const [localEmbedEndpointUrl, setLocalEmbedEndpointUrl] = useState(embedEndpointUrl);
  const [localEmbedApiKey, setLocalEmbedApiKey] = useState(embedApiKey);
  const [localRerankModelName, setLocalRerankModelName] = useState(rerankModelName);
  const [localRerankEndpointUrl, setLocalRerankEndpointUrl] = useState(rerankEndpointUrl);
  const [localRerankApiKey, setLocalRerankApiKey] = useState(rerankApiKey);
  const [localVlmModelName, setLocalVlmModelName] = useState(vlmModelName || "qwen3.8:27b");
  const [localVlmEndpointUrl, setLocalVlmEndpointUrl] = useState(vlmEndpointUrl || "http://litellm.litellm.svc.cluster.local:4000/v1");
  const [localVlmApiKey, setLocalVlmApiKey] = useState(vlmApiKey || "");
  const [localRagSettings, setLocalRagSettings] = useState(ragSettings);
  const [showAdvancedRag, setShowAdvancedRag] = useState(false);
  const [tempRagSettings, setTempRagSettings] = useState(null);
  const [preModalRagSettings, setPreModalRagSettings] = useState(null);

  const updateRagSetting = (key, value) => {
    setTempRagSettings(prev => (prev ? { ...prev, [key]: value } : null));
    setLocalRagSettings(prev => ({ ...prev, [key]: value }));
  };

  const [showAdvancedConfirmClose, setShowAdvancedConfirmClose] = useState(false);

  const handleCloseAdvancedWithCheck = () => {
    const hasChanges = JSON.stringify(tempRagSettings) !== JSON.stringify(preModalRagSettings);
    if (hasChanges) {
      setShowAdvancedConfirmClose(true);
    } else {
      setTempRagSettings(null);
      setPreModalRagSettings(null);
      setShowAdvancedRag(false);
    }
  };

  // Local states for Visibility Toggles
  const [localChatAgentToggle, setLocalChatAgentToggle] = useState(chatAgentToggle);
  const [localCodeAgentToggle, setLocalCodeAgentToggle] = useState(codeAgentToggle);
  const [localRagAgentToggle, setLocalRagAgentToggle] = useState(ragAgentToggle);

  // Model list fetching states
  const [ollamaModelsList, setOllamaModelsList] = useState([]);
  const [ollamaFetchError, setOllamaFetchError] = useState(false);
  const [ollamaFetching, setOllamaFetching] = useState(false);

  const [liteLlmModelsList, setLiteLlmModelsList] = useState(DEFAULT_LITELLM_MODELS);
  const [liteLlmFetchError, setLiteLlmFetchError] = useState(false);
  const [liteLlmFetching, setLiteLlmFetching] = useState(false);

  // Dropdown open states
  const [isOllamaListOpen, setIsOllamaListOpen] = useState(false);
  const [isLiteLlmListOpen, setIsLiteLlmListOpen] = useState(false);
  const [isCodeOllamaListOpen, setIsCodeOllamaListOpen] = useState(false);
  const [isCodeLiteLlmListOpen, setIsCodeLiteLlmListOpen] = useState(false);

  // MLIS endpoint discovery and validation states
  const [mlisEndpointsList, setMlisEndpointsList] = useState([]);
  const [mlisEndpointsFetching, setMlisEndpointsFetching] = useState(false);
  const [mlisEndpointsFetchError, setMlisEndpointsFetchError] = useState(false);
  const [isValidatingToken, setIsValidatingToken] = useState(false);
  const [tokenValidationStatus, setTokenValidationStatus] = useState("idle");
  const [validationMessage, setValidationMessage] = useState("");
  // T23 (design D6): whether the SERVER holds a credential for each endpoint
  // kind — from GET /api/health, presence only, never a value. A blank token
  // field then means "use the server's", and the hint under it says so.
  const [serverCredentials, setServerCredentials] = useState(null);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch("/api/health", { signal: AbortSignal.timeout(10000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setServerCredentials(j && j.credentials ? j.credentials : null); })
      .catch(() => { if (!cancelled) setServerCredentials(null); });
    return () => { cancelled = true; };
  }, [isOpen]);
  const serverCredentialHint = (kind) => {
    if (!serverCredentials) return null;
    const source = serverCredentials[kind];
    const held = source === "env" || source === "workload";
    return (
      <div className={`text-[10px] font-sans mt-0.5 ${held ? "text-emerald-400/80" : "text-amber-300/80"}`}>
        {held
          ? `Server credential: present (${source}) — leave blank to use it`
          : "Server credential: absent — paste a token, or configure the server's Secret"}
      </div>
    );
  };

  // Refs for click outside
  const ollamaAutocompleteRef = useRef(null);
  const liteLlmAutocompleteRef = useRef(null);
  const codeOllamaAutocompleteRef = useRef(null);
  const codeLiteLlmAutocompleteRef = useRef(null);

  const [localWeaviateUrl, setLocalWeaviateUrl] = useState(weaviateUrl);
  const [localTemperature, setLocalTemperature] = useState(temperature);
  const [localMaxTokens, setLocalMaxTokens] = useState(maxTokens);
  const [localSystemPrompt, setLocalSystemPrompt] = useState(systemPrompt);

  const [weaviateTesting, setWeaviateTesting] = useState(false);
  const [weaviateTestResponse, setWeaviateTestResponse] = useState("Awaiting Vector DB connection test...");
  const [openTooltip, setOpenTooltip] = useState(null);

  // Close tooltips on click outside
  useEffect(() => {
    if (!openTooltip) return;

    const handleOutsideClick = (e) => {
      setOpenTooltip(null);
    };

    // Use a small delay to avoid capturing the immediate click event that opens the tooltip
    const timer = setTimeout(() => {
      document.addEventListener("click", handleOutsideClick);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleOutsideClick);
    };
  }, [openTooltip]);

  const [querying, setQuerying] = useState(false);
  const [testResponse, setTestResponse] = useState("Awaiting verification query...");
  
  // Connection testing states for Code Agent and RAG Agent
  const [codeQuerying, setCodeQuerying] = useState(false);
  const [codeTestResponse, setCodeTestResponse] = useState("Awaiting verification query...");
  const [embedTesting, setEmbedTesting] = useState(false);
  const [embedTestResponse, setEmbedTestResponse] = useState("Awaiting Embedding connection test...");
  const [rerankTesting, setRerankTesting] = useState(false);
  const [rerankTestResponse, setRerankTestResponse] = useState("Awaiting Reranker connection test...");
  const [vlmTesting, setVlmTesting] = useState(false);
  const [vlmTestResponse, setVlmTestResponse] = useState("Awaiting Vision Language Model (VLM) connection test...");
  
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [showConfirmClose, setShowConfirmClose] = useState(false);

  const hasUnsavedChanges = 
    localEndpointType !== endpointType ||
    localMlisUrl !== mlisUrl ||
    localMlisToken !== mlisToken ||
    localLiteLlmUrl !== liteLlmUrl ||
    localLiteLlmToken !== liteLlmToken ||
    localOllamaUrl !== ollamaUrl ||
    localOllamaToken !== ollamaToken ||
    localOllamaModelName !== ollamaModelName ||
    localLiteLlmModelName !== liteLlmModelName ||
    localCodeEndpointType !== codeEndpointType ||
    localCodeMlisUrl !== codeMlisUrl ||
    localCodeMlisToken !== codeMlisToken ||
    localCodeLiteLlmUrl !== codeLiteLlmUrl ||
    localCodeLiteLlmToken !== codeLiteLlmToken ||
    localCodeOllamaUrl !== codeOllamaUrl ||
    localCodeOllamaToken !== codeOllamaToken ||
    localCodeOllamaModelName !== codeOllamaModelName ||
    localCodeLiteLlmModelName !== codeLiteLlmModelName ||
    localEmbedModelName !== embedModelName ||
    localEmbedEndpointUrl !== embedEndpointUrl ||
    localEmbedApiKey !== embedApiKey ||
    localRerankModelName !== rerankModelName ||
    localRerankEndpointUrl !== rerankEndpointUrl ||
    localRerankApiKey !== rerankApiKey ||
    localVlmModelName !== vlmModelName ||
    localVlmEndpointUrl !== vlmEndpointUrl ||
    localVlmApiKey !== vlmApiKey ||
    localChatAgentToggle !== chatAgentToggle ||
    localCodeAgentToggle !== codeAgentToggle ||
    localRagAgentToggle !== ragAgentToggle ||
    localWeaviateUrl !== weaviateUrl ||
    parseFloat(localTemperature) !== parseFloat(temperature) ||
    parseInt(localMaxTokens) !== parseInt(maxTokens) ||
    localSystemPrompt !== systemPrompt ||
    JSON.stringify(localRagSettings) !== JSON.stringify(ragSettings);

  const handleCloseAttempt = () => {
    if (hasUnsavedChanges) {
      setShowConfirmClose(true);
    } else {
      onClose();
    }
  };

  // Keyboard close handler
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        if (showConfirmClose) {
          setShowConfirmClose(false);
        } else {
          handleCloseAttempt();
        }
      }
    }
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, hasUnsavedChanges, showConfirmClose]);

  // Sync state with props when opening or if props change
  useEffect(() => {
    if (isOpen) {
      setLocalEndpointType("litellm");
      setLocalMlisUrl(mlisUrl);
      setLocalMlisToken(mlisToken);
      setLocalLiteLlmUrl(liteLlmUrl);
      setLocalLiteLlmToken(liteLlmToken);
      setLocalOllamaUrl(ollamaUrl);
      setLocalOllamaToken(ollamaToken);

      setLocalOllamaModelName(ollamaModelName);
      setLocalLiteLlmModelName(liteLlmModelName);

      setLocalCodeEndpointType("litellm");
      setLocalCodeMlisUrl(codeMlisUrl);
      setLocalCodeMlisToken(codeMlisToken);
      setLocalCodeLiteLlmUrl(codeLiteLlmUrl);
      setLocalCodeLiteLlmToken(codeLiteLlmToken);
      setLocalCodeOllamaUrl(codeOllamaUrl);
      setLocalCodeOllamaToken(codeOllamaToken);
      setLocalCodeOllamaModelName(codeOllamaModelName);
      setLocalCodeLiteLlmModelName(codeLiteLlmModelName);

      setLocalEmbedModelName(embedModelName);
      setLocalEmbedEndpointUrl(embedEndpointUrl);
      setLocalEmbedApiKey(embedApiKey);
      setLocalRerankModelName(rerankModelName);
      setLocalRerankEndpointUrl(rerankEndpointUrl);
      setLocalRerankApiKey(rerankApiKey);
      setLocalVlmModelName(vlmModelName);
      setLocalVlmEndpointUrl(vlmEndpointUrl);
      setLocalVlmApiKey(vlmApiKey);

      setLocalChatAgentToggle(chatAgentToggle);
      setLocalCodeAgentToggle(codeAgentToggle);
      setLocalRagAgentToggle(ragAgentToggle);

      setLocalWeaviateUrl(weaviateUrl);
      setLocalTemperature(temperature);
      setLocalMaxTokens(maxTokens);
      setLocalSystemPrompt(systemPrompt);
      setLocalRagSettings(ragSettings);
      setWeaviateTestResponse("Awaiting Vector DB connection test...");
      setOpenTooltip(null);
      
      setTestResponse("Awaiting verification query...");

      // Set active tab based on first visible toggle
      if (chatAgentToggle) setActiveTab("chat");
      else if (codeAgentToggle) setActiveTab("code");
      else if (ragAgentToggle) setActiveTab("rag");
      else setActiveTab("");
    }
  }, [
    isOpen,
    endpointType,
    mlisUrl,
    mlisToken,
    liteLlmUrl,
    liteLlmToken,
    ollamaUrl,
    ollamaToken,
    weaviateUrl,
    temperature,
    maxTokens,
    systemPrompt,
    ollamaModelName,
    liteLlmModelName,
    codeEndpointType,
    codeMlisUrl,
    codeMlisToken,
    codeLiteLlmUrl,
    codeLiteLlmToken,
    codeOllamaUrl,
    codeOllamaToken,
    codeOllamaModelName,
    codeLiteLlmModelName,
    embedModelName,
    embedEndpointUrl,
    embedApiKey,
    rerankModelName,
    rerankEndpointUrl,
    rerankApiKey,
    chatAgentToggle,
    codeAgentToggle,
    ragAgentToggle,
    ragSettings
  ]);

  // Click outside hook for autocompletes
  useEffect(() => {
    function handleClickOutside(event) {
      if (ollamaAutocompleteRef.current && !ollamaAutocompleteRef.current.contains(event.target)) {
        setIsOllamaListOpen(false);
      }
      if (liteLlmAutocompleteRef.current && !liteLlmAutocompleteRef.current.contains(event.target)) {
        setIsLiteLlmListOpen(false);
      }
      if (codeOllamaAutocompleteRef.current && !codeOllamaAutocompleteRef.current.contains(event.target)) {
        setIsCodeOllamaListOpen(false);
      }
      if (codeLiteLlmAutocompleteRef.current && !codeLiteLlmAutocompleteRef.current.contains(event.target)) {
        setIsCodeLiteLlmListOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Fetch models lists dynamically
  useEffect(() => {
    if (!isOpen) return;

    let active = true;

    const fetchLiteLlmModels = async () => {
      if (!localLiteLlmUrl) {
        if (active) {
          setLiteLlmModelsList([]);
          setLiteLlmFetchError(false);
        }
        return;
      }
      if (active) {
        setLiteLlmFetching(true);
        setLiteLlmFetchError(false);
      }
      try {
        // The key travels in the body, never the URL (F-104).
        const res = await fetch("/api/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: localLiteLlmUrl, token: localLiteLlmToken || "" }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.models)) {
            const filtered = data.models.filter(m => m !== "all-team-models" && m !== "*");
            if (active) {
              if (filtered.length > 0) {
                setLiteLlmModelsList(filtered);
                setLiteLlmFetchError(false);
              } else {
                setLiteLlmModelsList(DEFAULT_LITELLM_MODELS);
                setLiteLlmFetchError(false);
              }
            }
          } else {
            if (active) {
              setLiteLlmFetchError(true);
              setLiteLlmModelsList(DEFAULT_LITELLM_MODELS);
            }
          }
        } else {
          if (active) {
            setLiteLlmFetchError(true);
            setLiteLlmModelsList(DEFAULT_LITELLM_MODELS);
          }
        }
      } catch (err) {
        console.error("Failed to fetch LiteLLM models:", err);
        if (active) {
          setLiteLlmFetchError(true);
          setLiteLlmModelsList(DEFAULT_LITELLM_MODELS);
        }
      } finally {
        if (active) setLiteLlmFetching(false);
      }
    };
    fetchLiteLlmModels();

    return () => {
      active = false;
    };
  }, [isOpen, localLiteLlmUrl, localLiteLlmToken]);

  const validateMlisToken = async (url, token) => {
    if (!url || !token) {
      setTokenValidationStatus("idle");
      setValidationMessage("");
      return;
    }
    
    setIsValidatingToken(true);
    setTokenValidationStatus("idle");
    setValidationMessage("Verifying token connection...");
    
    try {
      const res = await fetch("/api/mlis-validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, token })
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.valid) {
          setTokenValidationStatus("success");
          setValidationMessage("Verified successfully! Saving token.");
          localStorage.setItem(`nxs_mlisToken_${url}`, token);
        } else {
          setTokenValidationStatus("error");
          setValidationMessage(`Verification failed (Status ${data.status || 401})`);
        }
      } else {
        setTokenValidationStatus("error");
        setValidationMessage(`Server returned error status ${res.status}`);
      }
    } catch (err) {
      setTokenValidationStatus("error");
      setValidationMessage(`Connection failed: ${err.message}`);
    } finally {
      setIsValidatingToken(false);
    }
  };

  if (!isOpen) return null;

  const handleSave = (e, reindexAccepted = false) => {
    if (e) e.preventDefault();
    // D31: a different embedding model (or endpoint) makes the stored vectors meaningless, so a save that changes it
    // re-indexes. The presenter is told first (the modal below); the destructive clear itself is the Standards
    // drawer's typed confirmation (T21 / E38).
    const embeddingChanged = localEmbedModelName !== embedModelName || localEmbedEndpointUrl !== embedEndpointUrl;
    if (embeddingChanged && !reindexAccepted) {
      setShowReindexNotice(true);
      return;
    }
    setSaving(true);

    setTimeout(() => {
      // Chat Agent LLM Settings (D31: every model comes from LiteLLM)
      setEndpointType("litellm");
      setMlisUrl(localMlisUrl);
      setMlisToken(localMlisToken);
      setLiteLlmUrl(localLiteLlmUrl);
      setLiteLlmToken(localLiteLlmToken);
      setOllamaUrl(localOllamaUrl);
      setOllamaToken(localOllamaToken);
      setOllamaModelName(localOllamaModelName);
      setLiteLlmModelName(localLiteLlmModelName);

      // Code Agent LLM Settings
      setCodeEndpointType("litellm");
      setCodeMlisUrl(localCodeMlisUrl);
      setCodeMlisToken(localCodeMlisToken);
      setCodeLiteLlmUrl(localCodeLiteLlmUrl);
      setCodeLiteLlmToken(localCodeLiteLlmToken);
      setCodeOllamaUrl(localCodeOllamaUrl);
      setCodeOllamaToken(localCodeOllamaToken);
      setCodeOllamaModelName(localCodeOllamaModelName);
      setCodeLiteLlmModelName(localCodeLiteLlmModelName);

      // RAG Agent Settings
      setEmbedModelName(localEmbedModelName);
      setEmbedEndpointUrl(localEmbedEndpointUrl);
      setEmbedApiKey(localEmbedApiKey);
      setRerankModelName(localRerankModelName);
      setRerankEndpointUrl(localRerankEndpointUrl);
      setRerankApiKey(localRerankApiKey);
      setVlmModelName(localVlmModelName);
      setVlmEndpointUrl(localVlmEndpointUrl);
      setVlmApiKey(localVlmApiKey);
      setRagSettings(localRagSettings);

      // Visibility Toggles
      setChatAgentToggle(localChatAgentToggle);
      setCodeAgentToggle(localCodeAgentToggle);
      setRagAgentToggle(localRagAgentToggle);

      // Store & App Configurations
      setWeaviateUrl(localWeaviateUrl);
      setTemperature(parseFloat(localTemperature));
      setMaxTokens(parseInt(localMaxTokens));
      setSystemPrompt(localSystemPrompt);

      // Compute and apply active endpoint for runtime execution in page.js
      const activeUrl = 
        localEndpointType === "mlis" ? localMlisUrl :
        localEndpointType === "litellm" ? localLiteLlmUrl :
        localOllamaUrl;
      
      const activeToken = 
        localEndpointType === "mlis" ? localMlisToken :
        localEndpointType === "litellm" ? localLiteLlmToken :
        localOllamaToken;

      nimEndpoint = activeUrl; // sync
      nimApiKey = activeToken; // sync

      setNimEndpoint(activeUrl);
      setNimApiKey(activeToken);

      // Save configurations to localStorage for persistence across reloads/sessions
      if (typeof window !== "undefined") {
        localStorage.setItem("nxs_endpointType", "litellm");
        localStorage.setItem("nxs_mlisUrl", localMlisUrl);
        localStorage.setItem("nxs_mlisToken", localMlisToken);
        localStorage.setItem("nxs_liteLlmUrl", localLiteLlmUrl);
        localStorage.setItem("nxs_liteLlmToken", localLiteLlmToken);
        localStorage.setItem("nxs_ollamaUrl", localOllamaUrl);
        localStorage.setItem("nxs_ollamaToken", localOllamaToken);
        localStorage.setItem("nxs_ollamaModelName", localOllamaModelName);
        localStorage.setItem("nxs_liteLlmModelName", localLiteLlmModelName);

        // Code Agent
        localStorage.setItem("nxs_codeEndpointType", "litellm");
        localStorage.setItem("nxs_codeMlisUrl", localCodeMlisUrl);
        localStorage.setItem("nxs_codeMlisToken", localCodeMlisToken);
        localStorage.setItem("nxs_codeLiteLlmUrl", localCodeLiteLlmUrl);
        localStorage.setItem("nxs_codeLiteLlmToken", localCodeLiteLlmToken);
        localStorage.setItem("nxs_codeOllamaUrl", localCodeOllamaUrl);
        localStorage.setItem("nxs_codeOllamaToken", localCodeOllamaToken);
        localStorage.setItem("nxs_codeOllamaModelName", localCodeOllamaModelName);
        localStorage.setItem("nxs_codeLiteLlmModelName", localCodeLiteLlmModelName);

        // RAG Agent
        localStorage.setItem("nxs_embedModelName", localEmbedModelName);
        localStorage.setItem("nxs_embedEndpointUrl", localEmbedEndpointUrl);
        localStorage.setItem("nxs_embedApiKey", localEmbedApiKey);
        localStorage.setItem("nxs_rerankModelName", localRerankModelName);
        localStorage.setItem("nxs_rerankEndpointUrl", localRerankEndpointUrl);
        localStorage.setItem("nxs_rerankApiKey", localRerankApiKey);
        localStorage.setItem("nxs_vlmModelName", localVlmModelName);
        localStorage.setItem("nxs_vlmEndpointUrl", localVlmEndpointUrl);
        localStorage.setItem("nxs_vlmApiKey", localVlmApiKey);
        // T17 (design D6): the blob page.js LOADS on the next start (F-82 —
        // this write had no reader before T17), whitelisted by construction.
        localStorage.setItem("nxs_ragSettings", JSON.stringify(localRagSettings));

        // Visibility Toggles
        localStorage.setItem("nxs_chatAgentToggle", localChatAgentToggle.toString());
        localStorage.setItem("nxs_codeAgentToggle", localCodeAgentToggle.toString());
        localStorage.setItem("nxs_ragAgentToggle", localRagAgentToggle.toString());

        localStorage.setItem("nxs_weaviateUrl", localWeaviateUrl);
        localStorage.removeItem("nxs_weaviateCollection");
        localStorage.setItem("nxs_temperature", localTemperature.toString());
        localStorage.setItem("nxs_maxTokens", localMaxTokens.toString());
        localStorage.setItem("nxs_systemPrompt", localSystemPrompt);
        localStorage.setItem("nxs_nimEndpoint", activeUrl);
        localStorage.setItem("nxs_nimApiKey", activeToken);
      }

      setSaving(false);
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
      }, 1500);
      if (embeddingChanged && typeof onEmbeddingChanged === "function") onEmbeddingChanged(localEmbedModelName);
    }, 800);
  };

  const handleRunTestQuery = async () => {
    setQuerying(true);
    setTestResponse("Sending verification query 'what LLM model are you?' to endpoint...");

    const testUrl = 
      localEndpointType === "mlis" ? localMlisUrl :
      localEndpointType === "litellm" ? localLiteLlmUrl :
      localOllamaUrl;

    const testToken = 
      localEndpointType === "mlis" ? localMlisToken :
      localEndpointType === "litellm" ? localLiteLlmToken :
      localOllamaToken;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "what LLM model are you?",
          isTestQuery: true,
          history: [],
          adminConfig: {
            nimEndpoint: testUrl,
            nimApiKey: testToken,
            nimModelName: localEndpointType === "ollama" ? localOllamaModelName : (localEndpointType === "litellm" ? localLiteLlmModelName : "nvidia/nemotron-nano-12b-v2-vl"),
            ollamaModelName: localOllamaModelName,
            liteLlmModelName: localLiteLlmModelName,
            temperature: 0.1,
            maxTokens: 150,
            systemPrompt: "You are a helpful assistant. State your name and model name briefly."
          }
        })
      });

      if (res.ok) {
        const data = await res.json();
        setTestResponse(data.response || "No text returned from the model.");
      } else {
        const errText = await res.text();
        setTestResponse(`Verification failed (Status ${res.status}): ${errText}`);
      }
    } catch (err) {
      setTestResponse(`Verification failed: ${err.message}`);
    } finally {
      setQuerying(false);
    }
  };

  const handleRunCodeTestQuery = async () => {
    setCodeQuerying(true);
    setCodeTestResponse("Sending verification query 'what LLM model are you?' to endpoint...");

    const testUrl = 
      localCodeEndpointType === "mlis" ? localCodeMlisUrl :
      localCodeEndpointType === "litellm" ? localCodeLiteLlmUrl :
      localCodeOllamaUrl;

    const testToken = 
      localCodeEndpointType === "mlis" ? localCodeMlisToken :
      localCodeEndpointType === "litellm" ? localCodeLiteLlmToken :
      localCodeOllamaToken;

    const testModelName = 
      localCodeEndpointType === "ollama" ? localCodeOllamaModelName :
      localCodeEndpointType === "litellm" ? localCodeLiteLlmModelName :
      "nvidia/nemotron-nano-12b-v2-vl";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "what LLM model are you?",
          isTestQuery: true,
          history: [],
          adminConfig: {
            nimEndpoint: testUrl,
            nimApiKey: testToken,
            nimModelName: testModelName,
            ollamaModelName: localCodeOllamaModelName,
            liteLlmModelName: localCodeLiteLlmModelName,
            temperature: 0.1,
            maxTokens: 150,
            systemPrompt: "You are a helpful assistant. State your name and model name briefly."
          }
        })
      });

      if (res.ok) {
        const data = await res.json();
        setCodeTestResponse(data.response || "No text returned from the model.");
      } else {
        const errText = await res.text();
        setCodeTestResponse(`Verification failed (Status ${res.status}): ${errText}`);
      }
    } catch (err) {
      setCodeTestResponse(`Verification failed: ${err.message}`);
    } finally {
      setCodeQuerying(false);
    }
  };

  const handleRunEmbedTest = async () => {
    setEmbedTesting(true);
    setEmbedTestResponse("Testing Embedding model endpoint connectivity...");
    try {
      const res = await fetch("/api/embedding-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: localEmbedEndpointUrl,
          model: localEmbedModelName,
          apiKey: localEmbedApiKey
        })
      });
      const data = await res.json();
      if (data.success) {
        setEmbedTestResponse(
          `Connection: SUCCESS\n` +
          `Response: Successfully generated vector embeddings!\n` +
          `Vector length: ${data.data?.data?.[0]?.embedding?.length || 0} dimensions\n` +
          `Usage: ${JSON.stringify(data.data?.usage || {})}`
        );
      } else {
        setEmbedTestResponse(
          `Connection: FAILED\n` +
          `Status: ${data.status || "Error"}\n` +
          `Error details: ${data.error}`
        );
      }
    } catch (err) {
      setEmbedTestResponse(`Connection: FAILED\nError: ${err.message}`);
    } finally {
      setEmbedTesting(false);
    }
  };

  const handleRunRerankTest = async () => {
    setRerankTesting(true);
    setRerankTestResponse("Testing Reranker model endpoint connectivity...");
    try {
      const res = await fetch("/api/rerank-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: localRerankEndpointUrl,
          model: localRerankModelName,
          apiKey: localRerankApiKey
        })
      });
      const data = await res.json();
      if (data.success) {
        setRerankTestResponse(
          `Connection: SUCCESS\n` +
          `Response: Rerank successful!\n` +
          `Results: ${JSON.stringify(data.data)}`
        );
      } else {
        setRerankTestResponse(
          `Connection: FAILED\n` +
          `Status: ${data.status || "Error"}\n` +
          `Error details: ${data.error}`
        );
      }
    } catch (err) {
      setRerankTestResponse(`Connection: FAILED\nError: ${err.message}`);
    } finally {
      setRerankTesting(false);
    }
  };

  const handleRunVlmTest = async () => {
    setVlmTesting(true);
    setVlmTestResponse("Testing Vision Language Model (VLM) endpoint connectivity...");
    try {
      const res = await fetch("/api/vlm-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: localVlmEndpointUrl,
          model: localVlmModelName,
          apiKey: localVlmApiKey
        })
      });
      const data = await res.json();
      if (data.success) {
        setVlmTestResponse(
          `Connection: SUCCESS\n` +
          `Provider: ${data.provider || "VLM API"}\n` +
          `Response: VLM Image Analysis test successful!\n` +
          `Output: ${data.data?.response || data.data?.choices?.[0]?.message?.content || JSON.stringify(data.data)}`
        );
      } else {
        setVlmTestResponse(
          `Connection: FAILED\n` +
          `Status: ${data.status || "Error"}\n` +
          `Error details: ${data.error}`
        );
      }
    } catch (err) {
      setVlmTestResponse(`Connection: FAILED\nError: ${err.message}`);
    } finally {
      setVlmTesting(false);
    }
  };

  const handleRunWeaviateTest = async () => {
    setWeaviateTesting(true);
    setWeaviateTestResponse("Checking Vector DB connectivity at endpoint...");

    try {
      const res = await fetch("/api/vectordb-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: localWeaviateUrl,
          token: localMlisToken || "",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setWeaviateTestResponse(
          `Connection: SUCCESS\n` +
          `Status: ${data.status}\n` +
          `Latency: ${data.latency}ms\n` +
          `Response: Weaviate meta details loaded!\n` +
          `Metadata: ${JSON.stringify(data.data, null, 2)}`
        );
      } else {
        setWeaviateTestResponse(
          `Connection: FAILED\n` +
          `Status: ${data.status || "Error"}\n` +
          `Latency: ${data.latency}ms\n` +
          `Error details: ${data.error}`
        );
      }
    } catch (err) {
      setWeaviateTestResponse(`Connection: FAILED\nError: ${err.message}`);
    } finally {
      setWeaviateTesting(false);
    }
  };

  const visibleTabs = [];
  if (localChatAgentToggle) visibleTabs.push({ id: "chat", label: "Chat Agent" });
  if (localCodeAgentToggle) visibleTabs.push({ id: "code", label: "Code Agent" });
  if (localRagAgentToggle) visibleTabs.push({ id: "rag", label: "RAG Agent" });
  // Polish Phase 3 (the owner's PL-D10 to PL-D12 (a) of 2026-10-14): the Misc tab, always shown: the token prices.
  visibleTabs.push({ id: "misc", label: "Misc" });

  const currentActiveTab = visibleTabs.some(t => t.id === activeTab)
    ? activeTab
    : (visibleTabs[0]?.id || "");

  return (
    <motion.div
      initial={{ scale: 0.97, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.97, opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 pl-20 flex bg-black/35 backdrop-blur-sm justify-center items-center p-8 overflow-y-auto animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleCloseAttempt();
        }
      }}
    >
      <div
        className="w-full max-w-7xl rounded-2xl border border-white/12 flex flex-col h-[93vh] shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden text-white bg-[#121212]/85 backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/10 flex justify-between items-center bg-white/2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-vivid/10 border border-brand-vivid/20 flex items-center justify-center text-brand-vivid">
              <RiSettings4Line size={16} />
            </div>
            <div>
              <h2 className="text-white text-xs md:text-sm font-sans font-bold uppercase tracking-[1.5px]">
                Presenter Admin Configurations
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {/* Header Toggles */}
            <div className="flex items-center gap-5 border-r border-white/10 pr-6">
              {/* Chat Toggle */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">Chat Agent</span>
                <button
                  type="button"
                  onClick={() => setLocalChatAgentToggle(!localChatAgentToggle)}
                  className="w-8 h-4 rounded-full relative transition-all duration-200 cursor-pointer border-0 outline-none"
                  style={{ backgroundColor: localChatAgentToggle ? '#F2561D' : 'rgba(255,255,255,0.1)' }}
                >
                  <div className={`w-3 h-3 bg-white rounded-full absolute top-[2px] transition-all duration-200 ${localChatAgentToggle ? 'left-[18px]' : 'left-[2px]'}`} />
                </button>
              </div>
              {/* Code Toggle */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">Code Agent</span>
                <button
                  type="button"
                  onClick={() => setLocalCodeAgentToggle(!localCodeAgentToggle)}
                  className="w-8 h-4 rounded-full relative transition-all duration-200 cursor-pointer border-0 outline-none"
                  style={{ backgroundColor: localCodeAgentToggle ? '#F2561D' : 'rgba(255,255,255,0.1)' }}
                >
                  <div className={`w-3 h-3 bg-white rounded-full absolute top-[2px] transition-all duration-200 ${localCodeAgentToggle ? 'left-[18px]' : 'left-[2px]'}`} />
                </button>
              </div>
              {/* RAG Toggle */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">RAG Agent</span>
                <button
                  type="button"
                  onClick={() => setLocalRagAgentToggle(!localRagAgentToggle)}
                  className="w-8 h-4 rounded-full relative transition-all duration-200 cursor-pointer border-0 outline-none"
                  style={{ backgroundColor: localRagAgentToggle ? '#F2561D' : 'rgba(255,255,255,0.1)' }}
                >
                  <div className={`w-3 h-3 bg-white rounded-full absolute top-[2px] transition-all duration-200 ${localRagAgentToggle ? 'left-[18px]' : 'left-[2px]'}`} />
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCloseAttempt}
              className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-neutrals-medium hover:text-white hover:bg-white/10 transition-all cursor-pointer"
            >
              <RiCloseLine size={16} />
            </button>
          </div>
        </div>

        {/* Tabs Row */}
        <div className="flex gap-2 border-b border-white/10 px-6 py-2.5 bg-[#161616]/40">
          {visibleTabs.map(tab => {
            const isActive = currentActiveTab === tab.id;
            const tabConfigs = {
              chat: {
                color: "#F2561D",
                bgColor: "rgba(242, 86, 29, 0.12)",
                borderColor: "rgba(242, 86, 29, 0.3)",
                glow: "rgba(242, 86, 29, 0.05)",
                icon: <RiChatAi4Line size={14} />
              },
              code: {
                color: "#008A8C",
                bgColor: "rgba(0, 138, 140, 0.12)",
                borderColor: "rgba(0, 138, 140, 0.3)",
                glow: "rgba(0, 138, 140, 0.05)",
                icon: <RiCodeBoxLine size={14} />
              },
              rag: {
                color: "#8B5CF6",
                bgColor: "rgba(139, 92, 246, 0.12)",
                borderColor: "rgba(139, 92, 246, 0.3)",
                glow: "rgba(139, 92, 246, 0.05)",
                icon: <RiBookletLine size={14} />
              },
              misc: {
                color: "#F59E0B",
                bgColor: "rgba(245, 158, 11, 0.12)",
                borderColor: "rgba(245, 158, 11, 0.3)",
                glow: "rgba(245, 158, 11, 0.05)",
                icon: <RiCoinLine size={14} />
              },
              connector: {
                color: "#64748B",
                bgColor: "rgba(100, 116, 139, 0.12)",
                borderColor: "rgba(100, 116, 139, 0.3)",
                glow: "rgba(100, 116, 139, 0.05)",
                icon: <RiDatabaseLine size={14} />
              }
            };
            const config = tabConfigs[tab.id] || tabConfigs.chat;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className="px-4 py-2 text-[10px] md:text-xs font-sans font-bold uppercase tracking-[1.2px] rounded-lg transition-all cursor-pointer border-0 outline-none flex items-center gap-1.5"
                style={{
                  backgroundColor: isActive ? config.bgColor : 'rgba(255, 255, 255, 0.02)',
                  color: isActive ? config.color : '#9ca3af',
                  border: isActive ? `1px solid ${config.borderColor}` : '1px solid rgba(255, 255, 255, 0.05)',
                  boxShadow: isActive ? `0 0 12px ${config.glow}` : 'none'
                }}
              >
                {config.icon}
                {tab.label}
              </button>
            );
          })}
          {visibleTabs.length === 0 && (
            <div className="py-2 text-xs font-sans text-neutrals-medium italic">
              All agent tabs are disabled. Use the toggles in the header to re-enable them.
            </div>
          )}
        </div>

        {/* Form Container */}
        <form onSubmit={handleSave} className="flex-1 overflow-hidden flex flex-col">
          
          {/* Scrollable Tab Panel Content */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar flex flex-col gap-6">
            
            {/* 1. Chat Agent Panel */}
            {currentActiveTab === "chat" && (
              <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full">
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <h3 className="text-white text-[11px] md:text-xs font-sans font-bold uppercase tracking-[1.2px] flex items-center gap-1.5">
                      <RiChatAi4Line size={14} className="text-[#F2561D]" />
                      CHAT AGENT LLM SETTINGS
                    </h3>
                    
                  </div>
                </div>

                {/* LiteLLM Settings */}
                <div className="flex flex-col gap-3.5 bg-white/2 border border-white/5 rounded-xl p-4">
                  <h4 className="text-white text-[10px] font-sans font-bold uppercase tracking-[1px] flex items-center gap-1.5">
                    LiteLLM Connection Settings
                  </h4>
                  <ModelCheck model={localLiteLlmModelName} token={localLiteLlmToken} />
                  <div className="flex flex-col gap-3.5">
                    <div className="flex flex-col gap-1 w-full relative font-sans" ref={liteLlmAutocompleteRef}>
                      <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                        Model Name
                      </label>
                      <input
                        type="text"
                        value={localLiteLlmModelName}
                        onChange={(e) => {
                          setLocalLiteLlmModelName(e.target.value);
                          setIsLiteLlmListOpen(true);
                        }}
                        onFocus={(e) => {
                          e.target.select();
                          setIsLiteLlmListOpen(true);
                        }}
                        className="py-1.5 px-3 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full"
                      />
                      {isLiteLlmListOpen && (
                        <div className="absolute top-[100%] left-0 right-0 mt-1 bg-[#181818] border border-white/15 rounded-lg max-h-48 overflow-y-auto custom-scrollbar shadow-2xl z-[100] p-1 flex flex-col gap-0.5">
                          {liteLlmFetching && (
                            <div className="py-2 px-3 text-[11px] text-neutrals-medium font-sans flex items-center gap-1.5 border-b border-white/5 pb-1.5 mb-1">
                              <RiLoader4Line size={12} className="animate-spin text-brand-vivid" />
                              Fetching models...
                            </div>
                          )}
                          {liteLlmFetchError && (
                            <div className="py-2 px-3 text-[11px] text-red-400 font-sans italic border-b border-white/5 pb-1.5 mb-1">
                              model list cannot be fetched
                            </div>
                          )}
                          {(() => {
                            const query = localLiteLlmModelName.toLowerCase();
                            const isExactMatch = liteLlmModelsList.some(m => m.toLowerCase() === query);
                            const filtered = isExactMatch ? liteLlmModelsList : liteLlmModelsList.filter(m => m.toLowerCase().includes(query));
                            if (filtered.length === 0) return <div className="py-2 px-3 text-[11px] text-neutrals-medium font-sans italic">No matching models</div>;
                            return filtered.map((model) => (
                              <button
                                key={model}
                                type="button"
                                onClick={() => {
                                  setLocalLiteLlmModelName(model);
                                  setIsLiteLlmListOpen(false);
                                }}
                                className="w-full text-left py-1.5 px-3 hover:bg-brand-vivid/10 hover:text-white rounded text-[11px] text-neutrals-light font-sans transition-all cursor-pointer border-0 bg-transparent outline-none"
                              >
                                {model}
                              </button>
                            ));
                          })()}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 w-full">
                      <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                        LiteLLM Model Endpoint URL
                      </label>
                      <input
                        type="text"
                        value={localLiteLlmUrl}
                        onChange={(e) => setLocalLiteLlmUrl(e.target.value)}
                        className="py-1.5 px-3 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-mono w-full"
                      />
                    </div>
                    <div className="flex flex-col gap-1 w-full">
                      <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                        Model API Endpoint Token
                      </label>
                      <input
                        type="text"
                        value={localLiteLlmToken}
                        onChange={(e) => setLocalLiteLlmToken(e.target.value)}
                        className="py-1.5 px-3 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-mono w-full"
                        style={{ WebkitTextSecurity: "disc" }}
                      />
                      {serverCredentialHint("litellm")}
                    </div>
                  </div>
                </div>

                {/* LLM Test Query Panel */}
                <div className="flex flex-col gap-1.5 w-full border-t border-white/5 pt-3">
                  <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                    LLM Test Query
                  </label>
                  <div className="flex gap-2 items-center bg-black/40 border border-white/10 rounded-lg p-2 w-full">
                    <div className="flex-1 text-xs text-neutrals-light font-mono truncate">
                      &quot;what LLM model are you?&quot;
                    </div>
                    <button
                      type="button"
                      onClick={handleRunTestQuery}
                      disabled={querying}
                      className="py-1 px-3 bg-brand-vivid hover:brightness-110 rounded text-[9px] font-sans font-bold uppercase tracking-[0.5px] text-white transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      {querying ? (
                        <RiLoader4Line size={12} className="animate-spin" />
                      ) : (
                        <>
                          <RiPlayLine size={12} />
                          Run Test
                        </>
                      )}
                    </button>
                  </div>
                  <div className="mt-1.5 p-3 rounded-lg border border-white/5 bg-black/60 text-[11px] font-mono leading-relaxed h-16 overflow-y-auto custom-scrollbar text-neutrals-light">
                    {testResponse}
                  </div>
                </div>
              </div>
            )}

            {/* 2. Code Agent Panel */}
            {currentActiveTab === "code" && (
              <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full">
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <h3 className="text-white text-[11px] md:text-xs font-sans font-bold uppercase tracking-[1.2px] flex items-center gap-1.5">
                      <RiCodeBoxLine size={14} className="text-[#008A8C]" />
                      CODE AGENT LLM SETTINGS
                    </h3>
                    
                  </div>
                </div>

                {/* LiteLLM Settings */}
                <div className="flex flex-col gap-3.5 bg-white/2 border border-white/5 rounded-xl p-4">
                  <h4 className="text-white text-[10px] font-sans font-bold uppercase tracking-[1px] flex items-center gap-1.5">
                    LiteLLM Connection Settings
                  </h4>
                  <ModelCheck model={localCodeLiteLlmModelName} token={localCodeLiteLlmToken} need="thinkingOff" />
                  <div className="flex flex-col gap-3.5">
                    <div className="flex flex-col gap-1 w-full relative font-sans" ref={codeLiteLlmAutocompleteRef}>
                      <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                        Model Name
                      </label>
                      <input
                        type="text"
                        value={localCodeLiteLlmModelName}
                        onChange={(e) => {
                          setLocalCodeLiteLlmModelName(e.target.value);
                          setIsCodeLiteLlmListOpen(true);
                        }}
                        onFocus={(e) => {
                          e.target.select();
                          setIsCodeLiteLlmListOpen(true);
                        }}
                        className="py-1.5 px-3 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full"
                      />
                      {isCodeLiteLlmListOpen && (
                        <div className="absolute top-[100%] left-0 right-0 mt-1 bg-[#181818] border border-white/15 rounded-lg max-h-48 overflow-y-auto custom-scrollbar shadow-2xl z-[100] p-1 flex flex-col gap-0.5">
                          {liteLlmFetching && (
                            <div className="py-2 px-3 text-[11px] text-neutrals-medium font-sans flex items-center gap-1.5 border-b border-white/5 pb-1.5 mb-1">
                              <RiLoader4Line size={12} className="animate-spin text-brand-vivid" />
                              Fetching models...
                            </div>
                          )}
                          {liteLlmFetchError && (
                            <div className="py-2 px-3 text-[11px] text-red-400 font-sans italic border-b border-white/5 pb-1.5 mb-1">
                              model list cannot be fetched
                            </div>
                          )}
                          {(() => {
                            const query = localCodeLiteLlmModelName.toLowerCase();
                            const isExactMatch = liteLlmModelsList.some(m => m.toLowerCase() === query);
                            const filtered = isExactMatch ? liteLlmModelsList : liteLlmModelsList.filter(m => m.toLowerCase().includes(query));
                            if (filtered.length === 0) return <div className="py-2 px-3 text-[11px] text-neutrals-medium font-sans italic">No matching models</div>;
                            return filtered.map((model) => (
                              <button
                                key={model}
                                type="button"
                                onClick={() => {
                                  setLocalCodeLiteLlmModelName(model);
                                  setIsCodeLiteLlmListOpen(false);
                                }}
                                className="w-full text-left py-1.5 px-3 hover:bg-brand-vivid/10 hover:text-white rounded text-[11px] text-neutrals-light font-sans transition-all cursor-pointer border-0 bg-transparent outline-none"
                              >
                                {model}
                              </button>
                            ));
                          })()}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 w-full">
                      <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                        LiteLLM Model Endpoint URL
                      </label>
                      <input
                        type="text"
                        value={localCodeLiteLlmUrl}
                        onChange={(e) => setLocalCodeLiteLlmUrl(e.target.value)}
                        className="py-1.5 px-3 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-mono w-full"
                      />
                    </div>
                    <div className="flex flex-col gap-1 w-full">
                      <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                        Model API Endpoint Token
                      </label>
                      <input
                        type="text"
                        value={localCodeLiteLlmToken}
                        onChange={(e) => setLocalCodeLiteLlmToken(e.target.value)}
                        className="py-1.5 px-3 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-mono w-full"
                        style={{ WebkitTextSecurity: "disc" }}
                      />
                      {serverCredentialHint("litellm")}
                    </div>
                  </div>
                </div>

                {/* LLM Test Query Panel */}
                <div className="flex flex-col gap-1.5 w-full border-t border-white/5 pt-3">
                  <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                    LLM Test Query
                  </label>
                  <div className="flex gap-2 items-center bg-black/40 border border-white/10 rounded-lg p-2 w-full">
                    <div className="flex-1 text-xs text-neutrals-light font-mono truncate">
                      &quot;what LLM model are you?&quot;
                    </div>
                    <button
                      type="button"
                      onClick={handleRunCodeTestQuery}
                      disabled={codeQuerying}
                      className="py-1 px-3 bg-brand-vivid hover:brightness-110 rounded text-[9px] font-sans font-bold uppercase tracking-[0.5px] text-white transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      {codeQuerying ? (
                        <RiLoader4Line size={12} className="animate-spin" />
                      ) : (
                        <>
                          <RiPlayLine size={12} />
                          Run Test
                        </>
                      )}
                    </button>
                  </div>
                  <div className="mt-1.5 p-3 rounded-lg border border-white/5 bg-black/60 text-[11px] font-mono leading-relaxed h-16 overflow-y-auto custom-scrollbar text-neutrals-light">
                    {codeTestResponse}
                  </div>
                </div>
              </div>
            )}

            {/* 3. RAG Agent Panel */}
            {/* Polish Phase 3: the token prices (PricingPanel reads and writes the server's table itself). */}
            {currentActiveTab === "misc" && (
              <PricingPanel configuredModels={[localOllamaModelName, localCodeOllamaModelName, localLiteLlmModelName, localCodeLiteLlmModelName]} />
            )}
            {currentActiveTab === "rag" && (
              <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full">
                {/* 3.1 RAG Pipeline Controls */}
                <div className="flex flex-col gap-3">
                  <div className="border-b border-white/5 pb-2">
                    <h3 className="text-white text-[11px] md:text-xs font-sans font-bold uppercase tracking-[1.2px] flex items-center gap-1.5">
                      <RiSettings4Line size={14} className="text-[#8B5CF6]" />
                      RAG Pipeline Controls
                    </h3>
                  </div>
                </div>

                <div className="flex flex-col gap-3.5 bg-white/2 border border-white/5 rounded-xl p-4">
                  <h4 className="text-white text-[10px] font-sans font-bold uppercase tracking-[1px] border-b border-white/5 pb-2">
                    Key RAG Controls
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Chunk Size */}
                    <div className="flex flex-col gap-1 w-full bg-black/20 border border-white/5 rounded-lg p-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                          Chunk Size
                          <InfoTooltip id="ks_chunkSize" text="Control how much text goes into each chunk, measured in characters (≈ 4 characters per token). Larger chunks preserve more context, while smaller chunks improve search precision and make retrieval more targeted." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                        </label>
                        <span className="text-[10px] font-mono text-white bg-white/5 px-2 py-0.5 rounded">
                          {localRagSettings.chunkSize} characters
                        </span>
                      </div>
                      <input 
                        type="range" 
                        min="200" 
                        max="1200" 
                        step="50"
                        value={localRagSettings.chunkSize} 
                        onChange={(e) => setLocalRagSettings({ ...localRagSettings, chunkSize: parseInt(e.target.value) })}
                        className="w-full accent-purple-500 h-1 bg-white/10 rounded-lg cursor-pointer animate-fade-in" 
                      />
                    </div>

                    {/* Chunk Overlap */}
                    <div className="flex flex-col gap-1 w-full bg-black/20 border border-white/5 rounded-lg p-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                          Chunk Overlap
                          <InfoTooltip id="ks_chunkOverlap" text="Control how much text is repeated between neighboring chunks, in characters (≈ 4 characters per token). More overlap protects against context being cut at chunk boundaries, while less overlap reduces duplication and index size." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                        </label>
                        <span className="text-[10px] font-mono text-white bg-white/5 px-2 py-0.5 rounded">
                          {localRagSettings.chunkOverlap} characters
                        </span>
                      </div>
                      <input 
                        type="range" 
                        min="0" 
                        max="250" 
                        step="10"
                        value={localRagSettings.chunkOverlap} 
                        onChange={(e) => setLocalRagSettings({ ...localRagSettings, chunkOverlap: parseInt(e.target.value) })}
                        className="w-full accent-purple-500 h-1 bg-white/10 rounded-lg cursor-pointer" 
                      />
                    </div>

                    {/* Hybrid Alpha */}
                    <div className="flex flex-col gap-1 w-full bg-black/20 border border-white/5 rounded-lg p-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                          Hybrid Alpha
                          <InfoTooltip id="ks_hybridAlpha" text="Control the balance between semantic similarity and keyword matching in hybrid search. Move it up for more concept-based retrieval, or down for more exact-term matching." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                        </label>
                        <span className="text-[10px] font-mono text-white bg-white/5 px-2 py-0.5 rounded">
                          {localRagSettings.hybridAlpha}
                        </span>
                      </div>
                      <input 
                        type="range" 
                        min="0" 
                        max="1" 
                        step="0.05"
                        value={localRagSettings.hybridAlpha} 
                        onChange={(e) => setLocalRagSettings({ ...localRagSettings, hybridAlpha: parseFloat(e.target.value) })}
                        className="w-full accent-purple-500 h-1 bg-white/10 rounded-lg cursor-pointer" 
                      />
                    </div>

                    {/* Top-K Retrieval */}
                    <div className="flex flex-col gap-1 w-full bg-black/20 border border-white/5 rounded-lg p-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                          Top-K Retrieval
                          <InfoTooltip id="ks_topKRetrieval" text="Control how many candidate results are retrieved before reranking and context selection. Higher values improve recall and downstream flexibility, while lower values improve speed and focus." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                        </label>
                        <span className="text-[10px] font-mono text-white bg-white/5 px-2 py-0.5 rounded">
                          {localRagSettings.topKRetrieval}
                        </span>
                      </div>
                      <input 
                        type="range" 
                        min="1" 
                        max="100" 
                        step="1"
                        value={localRagSettings.topKRetrieval} 
                        onChange={(e) => setLocalRagSettings({ ...localRagSettings, topKRetrieval: parseInt(e.target.value) })}
                        className="w-full accent-purple-500 h-1 bg-white/10 rounded-lg cursor-pointer" 
                      />
                    </div>

                    {/* Reranker Enabled */}
                    <div className="flex flex-col gap-2.5 w-full bg-black/20 border border-white/5 rounded-lg p-3 justify-between">
                      <div className="flex justify-between items-center w-full">
                        <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                          Reranker Enabled
                          <InfoTooltip id="ks_rerankerEnabled" text={`Controls the second-stage reranking pass that rescores retrieved chunks before sending them to the LLM.\n\n✅ ENABLE when: You are using a dedicated reranking API (HPE MLIS, vLLM, Jina, TEI) which provides accurate cross-encoder scoring.\n\n⚠️ CONSIDER DISABLING when: You are using Ollama as your reranker endpoint — Ollama does not natively support /v1/rerank and uses a text-generation workaround that may produce unreliable scores, especially for industrial or technical documents with part numbers.\n\n💡 TIP: If retrieval quality seems poor with reranking ON (wrong chunks being returned), try disabling it. The initial vector similarity ordering is often more reliable than the Ollama reranker workaround.`} openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                        </label>
                        <label className="relative inline-flex items-center cursor-pointer select-none">
                          <input 
                            type="checkbox" 
                            checked={localRagSettings.rerankerEnabled} 
                            onChange={(e) => setLocalRagSettings({ ...localRagSettings, rerankerEnabled: e.target.checked })} 
                            className="sr-only peer" 
                          />
                          <div className="w-8 h-4 bg-white/10 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-white after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-500"></div>
                        </label>
                      </div>
                      {/* Contextual guidance banner */}
                      <div className={`rounded-lg px-2.5 py-2 text-[9px] font-sans leading-relaxed ${localRagSettings.rerankerEnabled ? 'bg-purple-500/8 border border-purple-500/15 text-purple-300' : 'bg-amber-500/8 border border-amber-500/15 text-amber-300'}`}>
                        {localRagSettings.rerankerEnabled ? (
                          <>
                            <span className="font-bold">Reranking is ON.</span> Retrieved chunks will be rescored by the reranker model before being sent to the LLM. Best results when using a dedicated reranking API (HPE MLIS, vLLM, TEI). If using Ollama, scoring may be unreliable for some document types.
                          </>
                        ) : (
                          <>
                            <span className="font-bold">Reranking is OFF.</span> Chunks will be ranked by vector similarity only. This is recommended when using Ollama as the reranker endpoint, or when retrieval quality is poor with reranking enabled.
                          </>
                        )}
                      </div>
                    </div>

                    {/* Rerank Candidate Count */}
                    <div className="flex flex-col gap-1 w-full bg-black/20 border border-white/5 rounded-lg p-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                          Rerank Candidate Count
                          <InfoTooltip id="ks_candidatesToRerank" text="Control how many retrieved results the reranker is allowed to rescore. A larger candidate pool can improve final relevance, while a smaller one is faster but gives the reranker less room to help." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                        </label>
                        <span className="text-[10px] font-mono text-white bg-white/5 px-2 py-0.5 rounded">
                          {localRagSettings.candidatesToRerank}
                        </span>
                      </div>
                      <input 
                        type="range" 
                        min="1" 
                        max="100" 
                        step="1"
                        value={localRagSettings.candidatesToRerank} 
                        onChange={(e) => setLocalRagSettings({ ...localRagSettings, candidatesToRerank: parseInt(e.target.value) })}
                        className="w-full accent-purple-500 h-1 bg-white/10 rounded-lg cursor-pointer" 
                      />
                    </div>

                    {/* Rerank Property */}
                    <div className="flex flex-col gap-1 w-full bg-black/20 border border-white/5 rounded-lg p-3">
                      <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                        Rerank Property
                        <InfoTooltip id="ks_rerankProperty" text="Control which field the reranker uses to judge relevance. Richer text fields usually improve ranking quality, while shorter fields can be quicker and less noisy." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                      </label>
                      <select 
                        value={localRagSettings.rerankProperty} 
                        onChange={(e) => setLocalRagSettings({ ...localRagSettings, rerankProperty: e.target.value })}
                        className="py-1.5 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full text-left"
                      >
                        <option value="content">content</option>
                        <option value="title">title</option>
                        <option value="combined">combined field</option>
                      </select>
                    </div>

                    {/* Max Context Chunks */}
                    <div className="flex flex-col gap-1 w-full bg-black/20 border border-white/5 rounded-lg p-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                          Max Context Chunks
                          <InfoTooltip id="ks_maxContextChunks" text="Control how many top chunks are sent to the LLM as supporting evidence. Higher values give broader context, while lower values keep the prompt tighter, faster, and often more focused." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                        </label>
                        <span className="text-[10px] font-mono text-white bg-white/5 px-2 py-0.5 rounded">
                          {localRagSettings.maxContextChunks}
                        </span>
                      </div>
                      <input 
                        type="range" 
                        min="1" 
                        max="20" 
                        step="1"
                        value={localRagSettings.maxContextChunks} 
                        onChange={(e) => setLocalRagSettings({ ...localRagSettings, maxContextChunks: parseInt(e.target.value) })}
                        className="w-full accent-purple-500 h-1 bg-white/10 rounded-lg cursor-pointer" 
                      />
                    </div>

                    {/* T28 — page-level context assembly (design D3, D4) */}
                    <div className="flex flex-col gap-1 w-full bg-black/20 border border-white/5 rounded-lg p-3">
                      <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                        Page Companions
                        <InfoTooltip id="ks_pageCompanions" text="When a page's text is retrieved, also show the model the descriptions of that page's figures. Off: ranked chunks only. Figures: a retrieved passage brings its page's figure captions. Figures and page text: a retrieved figure also brings up to four passages of its page. Companions never exceed the Max Context Chunks count." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                      </label>
                      <select
                        value={localRagSettings.pageCompanions}
                        onChange={(e) => setLocalRagSettings({ ...localRagSettings, pageCompanions: e.target.value })}
                        className="py-1.5 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full text-left"
                      >
                        <option value="off">off</option>
                        <option value="captions">figures of retrieved pages</option>
                        <option value="page">figures and page text</option>
                      </select>
                    </div>

                    {/* T28 — document-scoped enumeration (design D14–D16, D19) */}
                    <div className="flex flex-col gap-1 w-full bg-black/20 border border-white/5 rounded-lg p-3">
                      <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                        Enumeration Scope
                        <InfoTooltip id="ks_enumerationScope" text="For a 'for each / list all' question, read the whole document the question is about (chosen by the retrieved results) in page order, when it fits the budget below, instead of the top-ranked chunks. Off keeps the ranked path. The answer's trace says which happened." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                      </label>
                      <select
                        value={localRagSettings.enumerationScope}
                        onChange={(e) => setLocalRagSettings({ ...localRagSettings, enumerationScope: e.target.value })}
                        className="py-1.5 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full text-left"
                      >
                        <option value="off">off — ranked chunks only</option>
                        <option value="document">whole document when it fits</option>
                      </select>
                    </div>

                    {/* T15 — document scope on lookup turns (design D4, D12) */}
                    <div className="flex flex-col gap-1 w-full bg-black/20 border border-white/5 rounded-lg p-3">
                      <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                        Lookup Scope
                        <InfoTooltip id="ks_lookupScope" text="For an ordinary question, when one document is in scope — selected in the chat composer, named in the question, or dominant in the retrieved results — leave passages from other documents out of the answer's context (they bring no figure captions either). Off keeps them, as before T15. The answer's scope chip and trace say what happened." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                      </label>
                      <select
                        value={localRagSettings.lookupScope}
                        onChange={(e) => setLocalRagSettings({ ...localRagSettings, lookupScope: e.target.value })}
                        className="py-1.5 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full text-left"
                      >
                        <option value="off">off — every retrieved passage is shown</option>
                        <option value="document">the document in scope only</option>
                      </select>
                    </div>

                    {/* T63 — a question on one selected document reads it whole (t63-design D7 (a)) */}
                    <div className="flex flex-col gap-1 w-full bg-black/20 border border-white/5 rounded-lg p-3">
                      <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                        Selected Document Read
                        <InfoTooltip id="ks_lookupDocumentRead" text="For an ordinary question with one document selected in the chat composer: read that whole document in page order when it fits the Whole-Document Budget below, and skip the reranker — every passage is shown. Ranked keeps the top-ranked passages, as before T63. A larger document, or a read that does not complete, falls back to the ranked passages; the answer's scope chip and trace say which happened." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                      </label>
                      <select
                        value={localRagSettings.lookupDocumentRead}
                        onChange={(e) => setLocalRagSettings({ ...localRagSettings, lookupDocumentRead: e.target.value })}
                        className="py-1.5 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full text-left"
                      >
                        <option value="whole">whole document when it fits</option>
                        <option value="ranked">ranked passages only</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1 w-full bg-black/20 border border-white/5 rounded-lg p-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                          Whole-Document Budget (tokens)
                          <InfoTooltip id="ks_documentContextBudget" text="The largest document (estimated tokens) read in full — by an enumeration question, or by a question on one selected document (Selected Document Read). 12 of the 14 demo documents fit under 80,000; a larger document falls back to the ranked chunks, and an enumeration's answer says its coverage is partial." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                        </label>
                        <span className="text-[10px] font-mono text-white bg-white/5 px-2 py-0.5 rounded">
                          {localRagSettings.documentContextBudget}
                        </span>
                      </div>
                      <input
                        type="number"
                        min="1000"
                        step="1000"
                        value={localRagSettings.documentContextBudget}
                        onChange={(e) => setLocalRagSettings({ ...localRagSettings, documentContextBudget: parseInt(e.target.value) || 80000 })}
                        className="py-1.5 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-mono w-full"
                      />
                    </div>

                  </div>

                  {/* Open Advanced Settings button */}
                  <div className="flex justify-end mt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setPreModalRagSettings({ ...localRagSettings });
                        setTempRagSettings({
                          ...localRagSettings
                        });
                        setShowAdvancedRag(true);
                      }}
                      className="inline-flex items-center justify-center py-2 px-5 rounded-full text-[11px] font-sans font-extrabold uppercase tracking-[1.5px] transition-all hover:scale-105 active:scale-95 cursor-pointer"
                      style={{
                        backgroundColor: 'rgba(139, 92, 246, 0.15)',
                        borderColor: '#8B5CF6',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        color: '#FFFFFF',
                        boxShadow: '0 0 10px rgba(139, 92, 246, 0.25)',
                      }}
                    >
                      Advanced Settings
                    </button>
                  </div>
                </div>

                {/* Advanced Settings Modal Overlay */}
                {showAdvancedRag && tempRagSettings && (
                  <div 
                    onClick={(e) => {
                      if (e.target === e.currentTarget) {
                        e.stopPropagation();
                        handleCloseAdvancedWithCheck();
                      }
                    }}
                    className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 overflow-y-auto animate-fade-in"
                  >
                    <div 
                      onClick={(e) => e.stopPropagation()}
                      className="w-full max-w-5xl rounded-2xl border border-white/12 flex flex-col h-[85vh] shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden text-white bg-[#121212]/95 backdrop-blur-xl animate-fade-in text-left"
                    >
                      {/* Header */}
                      <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-white/2">
                        <h3 className="text-white text-xs md:text-sm font-sans font-bold uppercase tracking-[1.5px] flex items-center gap-2">
                          <RiSettings4Line size={16} className="text-[#8B5CF6]" />
                          Advanced Pipeline Settings
                        </h3>
                        <button 
                          type="button"
                          onClick={handleCloseAdvancedWithCheck}
                          className="text-neutrals-medium hover:text-white transition-colors cursor-pointer"
                        >
                          <RiCloseLine size={20} />
                        </button>
                      </div>
                      
                      {/* Scrollable Content */}
                      <div className="flex-1 p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          
                          {/* 1. Documents Card */}
                          <div className="bg-black/20 border border-white/5 rounded-xl p-4 flex flex-col gap-3.5">
                            <h4 className="text-white text-[10px] font-sans font-bold uppercase tracking-[1px] border-b border-white/5 pb-2 text-[#A78BFA]">
                              Documents Settings
                            </h4>
                            
                            {/* Allowed File Types */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Allowed File Types
                                <InfoTooltip id="adv_allowedFileTypes" text="Select which file formats users can upload into the RAG pipeline. Allowing more file types makes the demo more flexible, but it also increases parsing complexity and the chance of inconsistent extraction results." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                {["PDF", "DOCX", "TXT", "MD", "CSV", "HTML", "XLSX", "PPTX"].map(opt => {
                                  const isSelected = tempRagSettings.allowedFileTypes.includes(opt);
                                  return (
                                    <button
                                      key={opt}
                                      type="button"
                                      onClick={() => {
                                        const current = tempRagSettings.allowedFileTypes;
                                        const updated = isSelected 
                                          ? current.filter(x => x !== opt) 
                                          : [...current, opt];
                                        updateRagSetting("allowedFileTypes", updated);
                                      }}
                                      className="inline-flex items-center justify-center py-1.5 px-3.5 rounded-full text-[9px] font-sans font-bold uppercase transition-all cursor-pointer hover:scale-105 active:scale-95"
                                      style={{
                                        backgroundColor: isSelected ? 'rgba(139, 92, 246, 0.2)' : 'rgba(0, 0, 0, 0.4)',
                                        borderColor: isSelected ? '#8B5CF6' : 'rgba(255, 255, 255, 0.15)',
                                        borderWidth: '1px',
                                        borderStyle: 'solid',
                                        color: isSelected ? '#FFFFFF' : '#A3A3A3',
                                      }}
                                    >
                                      {opt}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Max File Size */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Max File Size
                                <InfoTooltip id="adv_maxFileSize" text="Set the largest file size the system will accept for ingestion. Higher values allow bigger reports and manuals, but increase upload time, processing time, and the risk of slow or failed imports." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <div className="flex items-center gap-2">
                                <input 
                                  type="number" 
                                  min="1" 
                                  max="100"
                                  value={tempRagSettings.maxFileSize}
                                  onChange={(e) => updateRagSetting("maxFileSize", parseInt(e.target.value) || 25)}
                                  className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full"
                                  required
                                />
                                <span className="text-[10px] text-neutrals-medium font-sans">MB</span>
                              </div>
                            </div>

                            {/* Duplicate Policy */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Duplicate Policy
                                <InfoTooltip id="adv_duplicatePolicy" text="What happens when a document is ingested again. Skip: unchanged bytes are skipped (already indexed); a changed document supersedes its previous version. Overwrite: unchanged bytes are re-parsed and re-embedded too. There are only these two policies — the server tests for skip and treats anything else as overwrite." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <select
                                value={tempRagSettings.duplicatePolicy}
                                onChange={(e) => updateRagSetting("duplicatePolicy", e.target.value)}
                                className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full text-left"
                              >
                                {DUPLICATE_POLICIES.map((policy) => (
                                  <option key={policy} value={policy}>
                                    {policy === "skip" ? "Skip unchanged documents (changed ones supersede)" : "Overwrite (re-embed unchanged bytes too)"}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* T48 (t48-design D4, D5): the answer policy's labelled section — off by default (P4); request-level, no re-ingest */}
                            <div className="flex justify-between items-center bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Beyond the Documents
                                <InfoTooltip id="adv_beyondTheDocuments" text="Off (the default): answers stay within your documents. On: an answer may close with ONE section headed ‘Beyond the documents’ holding the model's own professional judgement or general knowledge that your documents do not state — shown in the chat in its own amber-labelled block as not from your documents, carrying no citation and left out of the citation audit (a citation marker inside it is reported, never hidden). Every fact from your documents stays above it with its citation. Its content is the model's own and can vary from one answer to the next. Applies from the next question; nothing is re-ingested." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <label className="relative inline-flex items-center cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={tempRagSettings.beyondTheDocuments === "on"}
                                  onChange={(e) => updateRagSetting("beyondTheDocuments", e.target.checked ? "on" : "off")}
                                  className="sr-only peer"
                                />
                                <div className="w-8 h-4 bg-white/10 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-white after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-brand-vivid"></div>
                              </label>
                            </div>

                            {/* T24 (design D6): Caption Figures toggle */}
                            <div className="flex justify-between items-center bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Caption Figures
                                <InfoTooltip id="adv_captionFigures" text="Caption figures and image-only pages with the Vision Language Model at ingest, so diagrams, floor plans and scanned pages become searchable text. Off = text only: no page is rendered, no image is written, no visual chunk is stored, and the ingest is much faster. A document ingested with captioning off is a new version of that document (it is re-indexed, not skipped)." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <label className="relative inline-flex items-center cursor-pointer select-none">
                                <input 
                                  type="checkbox" 
                                  checked={tempRagSettings.captionFigures} 
                                  onChange={(e) => updateRagSetting("captionFigures", e.target.checked)} 
                                  className="sr-only peer" 
                                />
                                <div className="w-8 h-4 bg-white/10 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-white after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-brand-vivid"></div>
                              </label>
                            </div>

                            {/* T31 (multimodal workshop design D5): the caption page budget */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Caption Page Budget
                                <InfoTooltip id="adv_captionPageBudget" text="How many pages of each document are sent to the captioner, in page order. 0 = every page (the default). Pages beyond the budget are not captioned — they are counted and listed by page number on the ingest record, in the ingest views and on the trace, never dropped silently. A first ingest of a long manual takes as long as its pages take, once: a page the caption memo already knows costs nothing. A non-zero budget makes the document a new version (its chunk set differs)." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={tempRagSettings.captionPageBudget ?? 0}
                                  onChange={(e) => updateRagSetting("captionPageBudget", Math.max(0, parseInt(e.target.value, 10) || 0))}
                                  className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full"
                                  required
                                />
                                <span className="text-[10px] text-neutrals-medium font-sans whitespace-nowrap">pages (0 = all)</span>
                              </div>
                            </div>

                            {/* T33 (t33-design D1 option B + E, D6, §12b): the detail passes — a pre-set level, never a per-document prompt */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Detail Passes
                                <InfoTooltip id="adv_detailPasses" text="A closer look at dense pages at ingest: the page is cut into four tiles, each read by the captioner with the page's own legend supplied as text, and the readings are merged in code into one extra searchable chunk per page (the key, an index of every labelled element, the counts per category, any disagreement between tiles disclosed). Auto (the default) takes the closer look only where the caption itself admits the detail did not fit into text: it names a legend, colour-coding, hatching or a symbol key, it wrote [illegible], or it ran out of room; plus any map or plan. All takes it on every visual page (about two minutes a page once, then free from the caption memo). Off takes none. Each file's ingest line names the pages that got the closer look and why, and under Auto how many visual pages did not qualify — switch to All and re-ingest to take the closer look on every visual page (the captions are recalled; only the new passes are asked). A value other than Auto makes the document a new version (its chunk set differs)." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <select
                                value={tempRagSettings.detailPasses ?? "auto"}
                                onChange={(e) => updateRagSetting("detailPasses", e.target.value)}
                                className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full text-left"
                              >
                                {DETAIL_PASS_MODES.map((mode) => (
                                  <option key={mode} value={mode}>
                                    {mode === "auto" ? "Auto — pages whose caption admits the detail did not fit (a legend, [illegible], an overflow; any map or plan)" : mode === "all" ? "All — every visual page (about two minutes a page, once)" : "Off — no detail passes"}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* T35 (t35-design D2, D3, D6–D8): OCR for pages without a text layer — a pre-set switch, decided per page at ingest */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                OCR for pages without text
                                <InfoTooltip id="adv_ocrNoTextPages" text="A PDF page with no machine-readable text at all (an image-only brochure, a scan) is read by OCR at ingest: the page is rendered and every printed line is read into the page's own searchable text, in reading order, and marked as OCR in an answer's sources. Only such pages are read; a page that has a text layer is never OCR'd, and the decision is made page by page, never for a whole document. The caption of a page OCR read is then written the way every text page's is (its visual content and labels), and the closer look's tile transcription is not taken on it (OCR already read the page whole). About three seconds a page on the server's CPU, no model call, the same text on every ingest. Off leaves such a page with its caption only. A value other than Auto makes the document a new version (its chunk set differs)." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <select
                                value={tempRagSettings.ocrNoTextPages ?? "auto"}
                                onChange={(e) => updateRagSetting("ocrNoTextPages", e.target.value)}
                                className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full text-left"
                              >
                                {OCR_MODES.map((mode) => (
                                  <option key={mode} value={mode}>
                                    {mode === "auto" ? "Auto — a page with no text layer is read by OCR at ingest (about three seconds a page, no model call)" : "Off — such a page keeps its caption only"}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Metadata Extraction Toggle */}
                            <div className="flex justify-between items-center bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Metadata Extraction
                                <InfoTooltip id="adv_metadataExtraction" text="Extract useful document metadata such as filename, title, author, page number, or timestamp and store it with the content. Turning this on improves filtering, traceability, and source display, while turning it off keeps ingestion simpler but removes useful context." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <label className="relative inline-flex items-center cursor-pointer select-none">
                                <input 
                                  type="checkbox" 
                                  checked={tempRagSettings.metadataExtraction} 
                                  onChange={(e) => updateRagSetting("metadataExtraction", e.target.checked)} 
                                  className="sr-only peer" 
                                />
                                <div className="w-8 h-4 bg-white/10 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-white after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-500"></div>
                              </label>
                            </div>

                          </div>

                          {/* 3. Chunking Card */}
                          <div className="bg-black/20 border border-white/5 rounded-xl p-4 flex flex-col gap-3.5">
                            <h4 className="text-white text-[10px] font-sans font-bold uppercase tracking-[1px] border-b border-white/5 pb-2 text-[#A78BFA]">
                              Chunking Settings
                            </h4>

                            {/* Chunk Size */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <div className="flex justify-between items-center">
                                <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                  Chunk Size
                                  <InfoTooltip id="adv_chunkSize" text="Set the target amount of text in each chunk before indexing, in characters (≈ 4 characters per token). Larger chunks preserve more context but can reduce retrieval precision, while smaller chunks improve targeting but may lose surrounding meaning." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                                </label>
                                <span className="text-[9px] font-mono text-white bg-white/5 px-1.5 py-0.5 rounded">
                                  {tempRagSettings.chunkSize} characters
                                </span>
                              </div>
                              <input 
                                type="range" 
                                min="200" 
                                max="1200" 
                                step="50"
                                value={tempRagSettings.chunkSize} 
                                onChange={(e) => updateRagSetting("chunkSize", parseInt(e.target.value))}
                                className="w-full accent-purple-500 h-1 bg-white/10 rounded-lg cursor-pointer" 
                              />
                            </div>

                            {/* Chunk Overlap */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <div className="flex justify-between items-center">
                                <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                  Chunk Overlap
                                  <InfoTooltip id="adv_chunkOverlap" text="Repeat some text between neighboring chunks so important context is not lost at chunk boundaries, in characters (≈ 4 characters per token). Higher overlap improves continuity and recall, but increases duplication, index size, and the chance of repetitive results." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                                </label>
                                <span className="text-[9px] font-mono text-white bg-white/5 px-1.5 py-0.5 rounded">
                                  {tempRagSettings.chunkOverlap} characters
                                </span>
                              </div>
                              <input 
                                type="range" 
                                min="0" 
                                max="250" 
                                step="10"
                                value={tempRagSettings.chunkOverlap} 
                                onChange={(e) => updateRagSetting("chunkOverlap", parseInt(e.target.value))}
                                className="w-full accent-purple-500 h-1 bg-white/10 rounded-lg cursor-pointer" 
                              />
                            </div>

                            {/* Minimum Chunk Size */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Minimum Chunk Size (characters)
                                <InfoTooltip id="adv_minChunkSize" text="Prevent very small fragments (in characters) from being stored as standalone chunks. Raising this value reduces noisy low-value chunks, while lowering it preserves more fine detail but can create many weak fragments." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <input 
                                type="number" 
                                min="50" 
                                max="400"
                                value={tempRagSettings.minChunkSize}
                                onChange={(e) => updateRagSetting("minChunkSize", parseInt(e.target.value) || 150)}
                                className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full"
                              />
                            </div>

                          </div>

                          {/* 4. Embeddings Card */}
                          <div className="bg-black/20 border border-white/5 rounded-xl p-4 flex flex-col gap-3.5">
                            <h4 className="text-white text-[10px] font-sans font-bold uppercase tracking-[1px] border-b border-white/5 pb-2 text-[#A78BFA]">
                              Embeddings Settings
                            </h4>

                            {/* Embedding Model (Read Only, reflects main RAG Agent tab settings) */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Embedding Model Name
                                <InfoTooltip id="adv_embedModelName" text="Choose the model used to convert text into vectors for semantic search. Larger or stronger models can improve retrieval quality, but they usually increase latency, GPU usage, and infrastructure cost." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <input 
                                type="text" 
                                readOnly
                                value={localEmbedModelName || "qwen3-embedding:8b"}
                                className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/60 text-xs text-neutrals-medium outline-none font-sans w-full cursor-not-allowed text-left"
                              />
                            </div>

                            {/* Inference URL (Read Only, reflects main RAG Agent tab settings) */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Inference URL
                                <InfoTooltip id="adv_embedEndpointUrl" text="Specify the endpoint Weaviate uses to call the embedding model service. Changing this can redirect vectorization to a faster, slower, local, or remote model service, so a bad value can reduce performance or break ingestion entirely." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <input 
                                type="text" 
                                readOnly
                                value={localEmbedEndpointUrl || ""}
                                className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/60 text-xs text-neutrals-medium outline-none font-mono w-full cursor-not-allowed text-left"
                              />
                            </div>

                            {/* Embed Batch Size (T17 D8, F-68) */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Embed Batch Size
                                <InfoTooltip id="adv_embedBatchSize" text="How many chunks are sent to the embedding endpoint per request during ingestion. Empty = auto: 64 for the GPU-served Ollama hosts, 16 for any other endpoint (a CPU-served MLIS model, a proxy). Set a number to override the endpoint rule." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <input
                                type="number"
                                min="1"
                                max="512"
                                placeholder="auto"
                                value={tempRagSettings.embedBatchSize ?? ""}
                                onChange={(e) => updateRagSetting("embedBatchSize", parseInt(e.target.value) > 0 ? parseInt(e.target.value) : null)}
                                className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full"
                              />
                            </div>

                            {/* Embed Concurrency (T17 D8, F-68) */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Embed Concurrency
                                <InfoTooltip id="adv_embedConcurrency" text="How many embedding batches are in flight at once during ingestion. Empty = auto: 5 for the GPU-served Ollama hosts, 1 for any other endpoint. Set a number to override the endpoint rule." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <input
                                type="number"
                                min="1"
                                max="32"
                                placeholder="auto"
                                value={tempRagSettings.embedConcurrency ?? ""}
                                onChange={(e) => updateRagSetting("embedConcurrency", parseInt(e.target.value) > 0 ? parseInt(e.target.value) : null)}
                                className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full"
                              />
                            </div>

                          </div>

                          {/* 5. Retrieval Card */}
                          <div className="bg-black/20 border border-white/5 rounded-xl p-4 flex flex-col gap-3.5">
                            <h4 className="text-white text-[10px] font-sans font-bold uppercase tracking-[1px] border-b border-white/5 pb-2 text-[#A78BFA]">
                              Retrieval Settings
                            </h4>

                            {/* Search Mode */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Search Mode
                                <InfoTooltip id="adv_searchMode" text="Choose how the system searches the database, such as keyword-only (BM25), vector-only (semantic), or a hybrid of both. Changing this mode has a huge impact on results, making it the most popular and visible query-time demo control." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <select 
                                value={tempRagSettings.searchMode}
                                onChange={(e) => updateRagSetting("searchMode", e.target.value)}
                                className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full text-left"
                              >
                                <option value="vector">Vector</option>
                                <option value="keyword">BM25 (keyword)</option>
                                <option value="hybrid">Hybrid</option>
                              </select>
                            </div>

                            {/* Hybrid Alpha */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <div className="flex justify-between items-center">
                                <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                  Hybrid Alpha
                                  <InfoTooltip id="adv_hybridAlpha" text="Control the balance between semantic similarity and keyword matching in hybrid search. Move it up for more concept-based retrieval, or down for more exact-term matching." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                                </label>
                                <span className="text-[9px] font-mono text-white bg-white/5 px-1.5 py-0.5 rounded">
                                  {tempRagSettings.hybridAlpha}
                                </span>
                              </div>
                              <input 
                                type="range" 
                                min="0" 
                                max="1" 
                                step="0.05"
                                value={tempRagSettings.hybridAlpha} 
                                onChange={(e) => updateRagSetting("hybridAlpha", parseFloat(e.target.value))}
                                className="w-full accent-purple-500 h-1 bg-white/10 rounded-lg cursor-pointer" 
                              />
                            </div>

                            {/* Top-K Retrieval */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <div className="flex justify-between items-center">
                                <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                  Top-K Retrieval
                                  <InfoTooltip id="adv_topKRetrieval" text="Control how many candidate results are retrieved before reranking and context selection. Higher values improve recall and downstream flexibility, while lower values improve speed and focus." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                                </label>
                                <span className="text-[9px] font-mono text-white bg-white/5 px-1.5 py-0.5 rounded">
                                  {tempRagSettings.topKRetrieval}
                                </span>
                              </div>
                              <input 
                                type="range" 
                                min="1" 
                                max="100" 
                                step="1"
                                value={tempRagSettings.topKRetrieval} 
                                onChange={(e) => updateRagSetting("topKRetrieval", parseInt(e.target.value))}
                                className="w-full accent-purple-500 h-1 bg-white/10 rounded-lg cursor-pointer" 
                              />
                            </div>

                            {/* Similarity Threshold Slider */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <div className="flex justify-between items-center">
                                <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                  Similarity Threshold
                                  <InfoTooltip id="adv_similarityThreshold" text="Set the minimum similarity score required for a retrieved vector chunk to be used. Raising this threshold filters out weak or irrelevant results, while lowering it ensures more chunks are retrieved even if they match poorly." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                                </label>
                                <span className="text-[9px] font-mono text-white bg-white/5 px-1.5 py-0.5 rounded">
                                  {tempRagSettings.similarityThreshold === 0 ? "Disabled" : tempRagSettings.similarityThreshold.toFixed(2)}
                                </span>
                              </div>
                              <input 
                                type="range" 
                                min="0" 
                                max="0.9" 
                                step="0.05"
                                value={tempRagSettings.similarityThreshold} 
                                onChange={(e) => updateRagSetting("similarityThreshold", parseFloat(e.target.value))}
                                className="w-full accent-purple-500 h-1 bg-white/10 rounded-lg cursor-pointer" 
                              />
                            </div>

                            {/* Max Context Chunks Slider */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <div className="flex justify-between items-center">
                                <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                  Max Context Chunks
                                  <InfoTooltip id="adv_maxContextChunks" text="Control how many top chunks are sent to the LLM as supporting evidence. Higher values give broader context, while lower values keep the prompt tighter, faster, and often more focused." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                                </label>
                                <span className="text-[9px] font-mono text-white bg-white/5 px-1.5 py-0.5 rounded">
                                  {tempRagSettings.maxContextChunks}
                                </span>
                              </div>
                              <input 
                                type="range" 
                                min="1" 
                                max="20" 
                                step="1"
                                value={tempRagSettings.maxContextChunks}
                                onChange={(e) => updateRagSetting("maxContextChunks", parseInt(e.target.value))}
                                className="w-full accent-purple-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                              />
                            </div>

                            {/* Counting — the aggregation knobs (T17 D8, F-46; T09) */}
                            <div className="text-[9px] font-sans font-bold uppercase tracking-[1px] text-neutrals-medium pt-1">
                              Counting (&quot;how many times does X appear&quot;)
                            </div>

                            {/* Aggregation Scan Limit */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Aggregation Scan Limit
                                <InfoTooltip id="adv_aggregationScanLimit" text="How many chunks a counting question scans (sent as both the retrieval depth and the slice, so the count covers every scanned chunk). Above the largest document in the corpus the count is exact; a scan that hits this cap is reported as capped." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <input
                                type="number"
                                min="1"
                                max="5000"
                                value={tempRagSettings.aggregationScanLimit}
                                onChange={(e) => updateRagSetting("aggregationScanLimit", parseInt(e.target.value) || RETRIEVAL_DEFAULTS.aggregationScanLimit)}
                                className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full"
                              />
                            </div>

                            {/* Count Stem Variants Toggle */}
                            <div className="flex justify-between items-center bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Count Stem Variants
                                <InfoTooltip id="adv_countStemVariants" text="Off: case-insensitive whole-word counting (test does not count testing). On: stem variants count too (s, 's, ing, ed, es). Retrieval expansion follows the same rule." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <label className="relative inline-flex items-center cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={tempRagSettings.countStemVariants}
                                  onChange={(e) => updateRagSetting("countStemVariants", e.target.checked)}
                                  className="sr-only peer"
                                />
                                <div className="w-8 h-4 bg-white/10 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-white after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-500"></div>
                              </label>
                            </div>

                            {/* Aggregation Evidence Lines */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Evidence Lines
                                <InfoTooltip id="adv_aggregationEvidenceLines" text="How many occurrence lines the model is shown as evidence for a counting answer. The count itself is computed server-side over every scanned chunk; this bounds the prompt, not the count." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <input
                                type="number"
                                min="0"
                                max="500"
                                value={tempRagSettings.aggregationEvidenceLines}
                                onChange={(e) => updateRagSetting("aggregationEvidenceLines", Number.isFinite(parseInt(e.target.value)) ? parseInt(e.target.value) : RETRIEVAL_DEFAULTS.aggregationEvidenceLines)}
                                className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full"
                              />
                            </div>

                          </div>

                          {/* 6. Reranking Card */}
                          <div className="bg-black/20 border border-white/5 rounded-xl p-4 flex flex-col gap-3.5">
                            <h4 className="text-white text-[10px] font-sans font-bold uppercase tracking-[1px] border-b border-white/5 pb-2 text-[#A78BFA]">
                              Reranking Settings
                            </h4>

                            {/* Reranker Enabled Toggle */}
                            <div className="flex flex-col gap-2 bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <div className="flex justify-between items-center">
                                <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                  Reranker Enabled
                                  <InfoTooltip id="adv_rerankerEnabled" text={`Controls the second-stage reranking pass that rescores retrieved chunks before sending them to the LLM.\n\n✅ ENABLE when:\n• Using a dedicated reranking API (HPE MLIS, vLLM, Jina, TEI) with accurate cross-encoder scoring.\n• Querying large document sets where initial vector recall may include many loosely-related chunks.\n\n⚠️ CONSIDER DISABLING when:\n• Using Ollama — it lacks native /v1/rerank support and uses a text-generation workaround that produces unreliable scores for industrial or technical documents (e.g. part numbers like T999 can be misinterpreted as relevance scores).\n• Retrieval quality drops after enabling — the vector similarity ordering may already be optimal for your documents.\n\n💡 Quick test: Run the same /doc query with reranking ON and OFF. Compare the trace logs to see which configuration returns more relevant chunks.`} openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                                </label>
                                <label className="relative inline-flex items-center cursor-pointer select-none">
                                  <input 
                                    type="checkbox" 
                                    checked={tempRagSettings.rerankerEnabled} 
                                    onChange={(e) => updateRagSetting("rerankerEnabled", e.target.checked)} 
                                    className="sr-only peer" 
                                  />
                                  <div className="w-8 h-4 bg-white/10 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-white after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-500"></div>
                                </label>
                              </div>
                              {/* Contextual guidance banner */}
                              <div className={`rounded-lg px-2.5 py-2 text-[9px] font-sans leading-relaxed ${tempRagSettings.rerankerEnabled ? 'bg-purple-500/8 border border-purple-500/15 text-purple-300' : 'bg-amber-500/8 border border-amber-500/15 text-amber-300'}`}>
                                {tempRagSettings.rerankerEnabled ? (
                                  <>
                                    <span className="font-bold">Reranking is ON.</span> Best with dedicated reranking APIs (HPE MLIS, vLLM, TEI). If using Ollama, scoring accuracy is limited due to the text-generation workaround — consider disabling if results are poor.
                                  </>
                                ) : (
                                  <>
                                    <span className="font-bold">Reranking is OFF.</span> Chunks ranked by vector similarity only. Recommended when using Ollama as reranker, or when reranking degrades retrieval quality for your documents.
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Reranker Model (Read Only, reflects main RAG Agent tab settings) */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Reranker Model Name
                                <InfoTooltip id="adv_rerankModelName" text="Choose the model used to rescore and reorder retrieved documents. Stronger reranker models do a better job placing the best answers at the top, but they add execution latency and computing cost." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <input 
                                type="text" 
                                readOnly
                                value={localRerankModelName || "qwen3-reranker-0.6b"}
                                className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/60 text-xs text-neutrals-medium outline-none font-sans w-full cursor-not-allowed text-left"
                              />
                            </div>

                            {/* Rerank Endpoint (Read Only, reflects main RAG Agent tab settings) */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Reranker Inference Endpoint
                                <InfoTooltip id="adv_rerankEndpointUrl" text="Specify the endpoint the reranker service is hosted on. If this URL is incorrect or the service is down, reranking will fail, which can break the search pipeline or bypass the reordering stage entirely." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <input 
                                type="text" 
                                readOnly
                                value={localRerankEndpointUrl || ""}
                                className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/60 text-xs text-neutrals-medium outline-none font-mono w-full cursor-not-allowed text-left"
                              />
                            </div>

                            {/* Rerank Property */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Rerank Property
                                <InfoTooltip id="adv_rerankProperty" text="Control which field the reranker uses to judge relevance. Richer text fields usually improve ranking quality, while shorter fields can be quicker and less noisy." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <select 
                                value={tempRagSettings.rerankProperty}
                                onChange={(e) => updateRagSetting("rerankProperty", e.target.value)}
                                className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full text-left"
                              >
                                <option value="content">content</option>
                                <option value="title">title</option>
                                <option value="combined">combined field</option>
                              </select>
                            </div>

                            {/* Rerank Query Override */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                Rerank Query Override
                                <InfoTooltip id="adv_rerankQueryOverride" text="Override the query sent to the reranker, allowing the search query and the rerank query to be different. This is useful in advanced workflows where a query is expanded or clarified before rescoring." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                              </label>
                              <input 
                                type="text" 
                                placeholder="Empty = use search query"
                                value={tempRagSettings.rerankQueryOverride}
                                onChange={(e) => updateRagSetting("rerankQueryOverride", e.target.value)}
                                className="py-1 px-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full"
                              />
                            </div>

                            {/* Rerank Candidate Count */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <div className="flex justify-between items-center">
                                <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                  Rerank Candidate Count
                                  <InfoTooltip id="adv_candidatesToRerank" text="Control how many retrieved results the reranker is allowed to rescore. A larger candidate pool can improve final relevance, while a smaller one is fast but gives the reranker less room to help." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                                </label>
                                <span className="text-[9px] font-mono text-white bg-white/5 px-1.5 py-0.5 rounded">
                                  {tempRagSettings.candidatesToRerank}
                                </span>
                              </div>
                              <input 
                                type="range" 
                                min="1" 
                                max="100" 
                                step="1"
                                value={tempRagSettings.candidatesToRerank} 
                                onChange={(e) => updateRagSetting("candidatesToRerank", parseInt(e.target.value))}
                                className="w-full accent-purple-500 h-1 bg-white/10 rounded-lg cursor-pointer" 
                              />
                            </div>

                            {/* Keep Top N After Rerank */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <div className="flex justify-between items-center">
                                <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                  Keep Top N After Rerank
                                  <InfoTooltip id="adv_keepTopNAfterRerank" text="Control how many top reranked chunks survive to be used as final context for the LLM. Keeping more chunks provides broader supporting evidence but increases prompt sizes and can distract the model, while keeping fewer chunks keeps prompts focused." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                                </label>
                                <span className="text-[9px] font-mono text-white bg-white/5 px-1.5 py-0.5 rounded">
                                  {tempRagSettings.keepTopNAfterRerank}
                                </span>
                              </div>
                              <input 
                                type="range" 
                                min="1" 
                                max="20" 
                                step="1"
                                value={tempRagSettings.keepTopNAfterRerank} 
                                onChange={(e) => updateRagSetting("keepTopNAfterRerank", parseInt(e.target.value))}
                                className="w-full accent-purple-500 h-1 bg-white/10 rounded-lg cursor-pointer" 
                              />
                            </div>

                            {/* Min Rerank Score */}
                            <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5">
                              <div className="flex justify-between items-center">
                                <label className="text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                                  Min Rerank Score
                                  <InfoTooltip id="adv_minRerankScore" text="Set the minimum score a chunk must receive from the reranker to be included in the final context. Raising this score filters out poor matches, while lowering it allows weaker matches through when search coverage is low." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                                </label>
                                <span className="text-[9px] font-mono text-white bg-white/5 px-1.5 py-0.5 rounded">
                                  {tempRagSettings.minRerankScore === 0 ? "Disabled" : tempRagSettings.minRerankScore.toFixed(2)}
                                </span>
                              </div>
                              <input 
                                type="range" 
                                min="0" 
                                max="1" 
                                step="0.05"
                                value={tempRagSettings.minRerankScore} 
                                onChange={(e) => updateRagSetting("minRerankScore", parseFloat(e.target.value))}
                                className="w-full accent-purple-500 h-1 bg-white/10 rounded-lg cursor-pointer" 
                              />
                            </div>
                          </div>

                        </div>
                      </div>
                      
                      {/* Footer with OK and CANCEL */}
                      <div className="px-6 py-4 border-t border-white/5 flex justify-end gap-3 bg-black/40 shrink-0">
                        <button 
                          type="button" 
                          onClick={handleCloseAdvancedWithCheck}
                          className="px-4 py-1.5 rounded-lg border border-white/10 text-xs font-sans font-bold uppercase tracking-[0.5px] text-neutrals-light hover:bg-white/5 transition-all cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button 
                          type="button" 
                          onClick={() => {
                            setPreModalRagSettings(null);
                            setTempRagSettings(null);
                            setShowAdvancedRag(false);
                          }}
                          className="px-5 py-1.5 bg-brand-vivid hover:brightness-110 rounded-lg text-xs font-sans font-bold uppercase tracking-[0.5px] text-white transition-all cursor-pointer"
                        >
                          OK
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Custom Advanced Settings Unsaved Changes Confirmation Modal */}
                {showAdvancedConfirmClose && (
                  <div 
                    onClick={(e) => {
                      if (e.target === e.currentTarget) {
                        e.stopPropagation();
                        setShowAdvancedConfirmClose(false);
                      }
                    }}
                    className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/60 backdrop-blur-md"
                  >
                    <div 
                      onClick={(e) => e.stopPropagation()}
                      className="w-full max-w-md bg-[#181818] border border-white/10 rounded-2xl p-6 shadow-2xl text-white"
                    >
                      <h3 className="text-sm font-sans font-bold uppercase tracking-[1.5px] text-white mb-2">
                        Unsaved Advanced Settings
                      </h3>
                      <p className="text-xs text-neutrals-medium font-sans leading-relaxed mb-6">
                        You have modified RAG configurations in the Advanced Settings that have not been applied. Would you like to save these changes before closing?
                      </p>
                      <div className="flex justify-end gap-3 font-sans text-[10px] font-bold uppercase tracking-[0.5px]">
                        <button
                          type="button"
                          onClick={() => setShowAdvancedConfirmClose(false)}
                          className="px-4 py-2 rounded-lg border border-white/10 bg-transparent text-neutrals-light hover:bg-white/5 transition-all cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            // Discard changes: restore local settings to the pre-modal backup snapshot
                            if (preModalRagSettings) {
                              setLocalRagSettings(preModalRagSettings);
                            }
                            setPreModalRagSettings(null);
                            setTempRagSettings(null);
                            setShowAdvancedConfirmClose(false);
                            setShowAdvancedRag(false);
                          }}
                          className="px-4 py-2 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-all cursor-pointer"
                        >
                          Discard Changes
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            // Save changes: keep local settings as is (which were updated live)
                            setPreModalRagSettings(null);
                            setTempRagSettings(null);
                            setShowAdvancedConfirmClose(false);
                            setShowAdvancedRag(false);
                          }}
                          className="px-4 py-2 rounded-lg bg-brand-vivid hover:brightness-110 text-white transition-all cursor-pointer"
                        >
                          Save & Close
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3.2 Model Endpoints */}
                <div className="flex flex-col gap-3">
                  <div className="border-b border-white/5 pb-2">
                    <h3 className="text-white text-[11px] md:text-xs font-sans font-bold uppercase tracking-[1.2px] flex items-center gap-1.5">
                      <RiCpuLine size={14} className="text-[#8B5CF6]" />
                      Model Endpoints
                    </h3>
                  </div>
                </div>

                {/* Embedding Model Settings */}
                <div className="flex flex-col gap-3.5 bg-white/2 border border-white/5 rounded-xl p-4">
                  <h4 className="text-white text-[10px] font-sans font-bold uppercase tracking-[1px]">
                    Embedding Model Configurations
                  </h4>
                  <ModelCheck model={localEmbedModelName} token={localEmbedApiKey} />
                  <div className="flex flex-col gap-3.5">
                    <div className="flex flex-col gap-1 w-full">
                      <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                        Model Name
                      </label>
                      <input
                        type="text"
                        value={localEmbedModelName}
                        onChange={(e) => setLocalEmbedModelName(e.target.value)}
                        className="py-1.5 px-3 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full"
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1 w-full">
                      <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                        Endpoint URL
                      </label>
                      <input
                        type="text"
                        value={localEmbedEndpointUrl}
                        onChange={(e) => setLocalEmbedEndpointUrl(e.target.value)}
                        className="py-1.5 px-3 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-mono w-full"
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1 w-full">
                      <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                        API Token
                      </label>
                      <input
                        type="text"
                        value={localEmbedApiKey}
                        onChange={(e) => setLocalEmbedApiKey(e.target.value)}
                        className="py-1.5 px-3 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-mono w-full"
                        style={{ WebkitTextSecurity: "disc" }}
                      />
                      {serverCredentialHint("embed")}
                    </div>
                  </div>

                  {/* Embedding Test Runner */}
                  <div className="flex flex-col gap-1.5 w-full border-t border-white/5 pt-3 mt-1.5">
                    <div className="flex gap-2 items-center bg-black/40 border border-white/10 rounded-lg p-2 w-full">
                      <div className="flex-1 text-[10px] text-neutrals-light font-mono truncate">
                        POST /v1/embeddings - {"{model: '"}{localEmbedModelName}{"', input: ['test query']}"}
                      </div>
                      <button
                        type="button"
                        onClick={handleRunEmbedTest}
                        disabled={embedTesting}
                        className="py-1 px-3 bg-brand-vivid hover:brightness-110 rounded text-[9px] font-sans font-bold uppercase tracking-[0.5px] text-white transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        {embedTesting ? (
                          <RiLoader4Line size={12} className="animate-spin" />
                        ) : (
                          <>
                            <RiPlayLine size={12} />
                            Run Test
                          </>
                        )}
                      </button>
                    </div>
                    <div className="mt-1.5 p-3 rounded-lg border border-white/5 bg-black/60 text-[11px] font-mono leading-relaxed h-20 overflow-y-auto custom-scrollbar text-neutrals-light whitespace-pre-wrap">
                      {embedTestResponse}
                    </div>
                  </div>
                </div>

                {/* Reranker Model Settings */}
                <div className="flex flex-col gap-3.5 bg-white/2 border border-white/5 rounded-xl p-4">
                  <h4 className="text-white text-[10px] font-sans font-bold uppercase tracking-[1px]">
                    Reranker Model Configurations
                  </h4>
                  <ModelCheck model={localRerankModelName} token={localRerankApiKey} />
                  <div className="flex flex-col gap-3.5">
                    <div className="flex flex-col gap-1 w-full">
                      <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                        Model Name
                      </label>
                      <input
                        type="text"
                        value={localRerankModelName}
                        onChange={(e) => setLocalRerankModelName(e.target.value)}
                        className="py-1.5 px-3 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full"
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1 w-full">
                      <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                        Endpoint URL
                      </label>
                      <input
                        type="text"
                        value={localRerankEndpointUrl}
                        onChange={(e) => setLocalRerankEndpointUrl(e.target.value)}
                        className="py-1.5 px-3 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-mono w-full"
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1 w-full">
                      <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                        API Token
                      </label>
                      <input
                        type="text"
                        value={localRerankApiKey}
                        onChange={(e) => setLocalRerankApiKey(e.target.value)}
                        className="py-1.5 px-3 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-mono w-full"
                        style={{ WebkitTextSecurity: "disc" }}
                      />
                      {serverCredentialHint("rerank")}
                    </div>
                  </div>

                  {/* Reranker Test Runner */}
                  <div className="flex flex-col gap-1.5 w-full border-t border-white/5 pt-3 mt-1.5">
                    <div className="flex gap-2 items-center bg-black/40 border border-white/10 rounded-lg p-2 w-full">
                      <div className="flex-1 text-[10px] text-neutrals-light font-mono truncate">
                        POST /v1/rerank - {"{model: '"}{localRerankModelName}{"', query: 'test query', docs: [...]}"}
                      </div>
                      <button
                        type="button"
                        onClick={handleRunRerankTest}
                        disabled={rerankTesting}
                        className="py-1 px-3 bg-brand-vivid hover:brightness-110 rounded text-[9px] font-sans font-bold uppercase tracking-[0.5px] text-white transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        {rerankTesting ? (
                          <RiLoader4Line size={12} className="animate-spin" />
                        ) : (
                          <>
                            <RiPlayLine size={12} />
                            Run Test
                          </>
                        )}
                      </button>
                    </div>
                    <div className="mt-1.5 p-3 rounded-lg border border-white/5 bg-black/60 text-[11px] font-mono leading-relaxed h-20 overflow-y-auto custom-scrollbar text-neutrals-light whitespace-pre-wrap">
                      {rerankTestResponse}
                    </div>
                  </div>
                </div>

                {/* Vision Language Model (VLM) Settings */}
                <div className="flex flex-col gap-3.5 bg-white/2 border border-white/5 rounded-xl p-4">
                  <h4 className="text-white text-[10px] font-sans font-bold uppercase tracking-[1px]">
                    Vision Language Model (VLM) Configurations
                  </h4>
                  <ModelCheck model={localVlmModelName} token={localVlmApiKey} need="captioning" />
                  <div className="flex flex-col gap-3.5">
                    <div className="flex flex-col gap-1 w-full">
                      <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1">
                        Model Name
                        <InfoTooltip id="vlm_modelName" text="The vision-language model that captions figures and image-only pages at ingest (T17: these three fields now reach ingest; before, they fed the connection test only). The model name is part of every document's version fingerprint, so changing it re-indexes every document — of every format — on the next ingest. The default is qwen3.8:27b — the chat model, which reads images (T37: measured equal to qwen3-vl:30b on every gate question, with no truncated pages); qwen3-vl:30b remains available by name." openTooltip={openTooltip} setOpenTooltip={setOpenTooltip} />
                      </label>
                      <input
                        type="text"
                        value={localVlmModelName}
                        onChange={(e) => setLocalVlmModelName(e.target.value)}
                        className="py-1.5 px-3 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-sans w-full"
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1 w-full">
                      <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                        Endpoint URL
                      </label>
                      <input
                        type="text"
                        value={localVlmEndpointUrl}
                        onChange={(e) => setLocalVlmEndpointUrl(e.target.value)}
                        className="py-1.5 px-3 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-mono w-full"
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1 w-full">
                      <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                        API Token
                      </label>
                      <input
                        type="text"
                        value={localVlmApiKey}
                        onChange={(e) => setLocalVlmApiKey(e.target.value)}
                        className="py-1.5 px-3 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-mono w-full"
                        style={{ WebkitTextSecurity: "disc" }}
                      />
                    </div>
                  </div>

                  {/* VLM Test Runner */}
                  <div className="flex flex-col gap-1.5 w-full border-t border-white/5 pt-3 mt-1.5">
                    <div className="flex gap-2 items-center bg-black/40 border border-white/10 rounded-lg p-2 w-full">
                      <div className="flex-1 text-[10px] text-neutrals-light font-mono truncate">
                        POST /api/generate - {"{model: '"}{localVlmModelName}{"', prompt: 'Describe image...', images: [...]}"}
                      </div>
                      <button
                        type="button"
                        onClick={handleRunVlmTest}
                        disabled={vlmTesting}
                        className="py-1 px-3 bg-brand-vivid hover:brightness-110 rounded text-[9px] font-sans font-bold uppercase tracking-[0.5px] text-white transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        {vlmTesting ? (
                          <RiLoader4Line size={12} className="animate-spin" />
                        ) : (
                          <>
                            <RiPlayLine size={12} />
                            Run Test
                          </>
                        )}
                      </button>
                    </div>
                    <div className="mt-1.5 p-3 rounded-lg border border-white/5 bg-black/60 text-[11px] font-mono leading-relaxed h-20 overflow-y-auto custom-scrollbar text-neutrals-light whitespace-pre-wrap">
                      {vlmTestResponse}
                    </div>
                  </div>
                </div>

                {/* 3.3 Vector DB Endpoints */}
                <div className="flex flex-col gap-3">
                  <div className="border-b border-white/5 pb-2">
                    <h3 className="text-white text-[11px] md:text-xs font-sans font-bold uppercase tracking-[1.2px] flex items-center gap-1.5">
                      <RiDatabase2Line size={14} className="text-[#8B5CF6]" />
                      Vector DB Endpoints
                    </h3>
                  </div>
                </div>

                {/* Vector DB Configurations */}
                <div className="flex flex-col gap-3.5 bg-white/2 border border-white/5 rounded-xl p-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-white text-[10px] font-sans font-bold uppercase tracking-[1px]">
                      Vector DB Configurations
                    </h4>
                  </div>

                  <div className="flex flex-col gap-3.5">
                    <div className="flex flex-col gap-1 w-full">
                      <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-1 relative">
                        Endpoint URL
                        <span className="flex items-center shrink-0 cursor-pointer text-neutrals-medium hover:text-white select-none" onClick={(e) => { e.stopPropagation(); setOpenTooltip(openTooltip === "weaviateUrl" ? null : "weaviateUrl"); }}>
                          <RiInformationLine size={11} />
                        </span>
                        {openTooltip === "weaviateUrl" && (
                          <span className="absolute bottom-7 left-0 z-50 bg-[#121212] border border-white/15 rounded-xl p-3 text-[12px] md:text-[13px] text-white normal-case font-normal tracking-normal leading-relaxed w-72 md:w-80 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                            The cluster-internal IP address and port for the Weaviate Vector Database instance.
                          </span>
                        )}
                      </label>
                      <input
                        type="text"
                        value={localWeaviateUrl}
                        onChange={(e) => setLocalWeaviateUrl(e.target.value)}
                        className="py-1.5 px-3 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid font-mono w-full"
                        required
                      />
                    </div>

                    {/* T17 (design D7): the class chat reads and Tidy Up drops, computed by
                        the SAME two functions the server calls — resolveSchemaVersion and
                        collectionNameForVersion — so this line cannot disagree with them.
                        The schema version is an API-only override (the cut-over's one-release
                        flag), so there is no control here. */}
                    <div className="flex flex-col gap-1 w-full bg-black/25 border border-white/5 rounded-lg p-2.5" data-testid="schema-line">
                      <span className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                        Collection
                      </span>
                      <p className="text-[10px] font-mono text-neutrals-light leading-relaxed">
                        Collection <span className="text-white">{RETRIEVAL_DEFAULTS.weaviateCollection}</span>
                        {" → class "}
                        <span className="text-white">{collectionNameForVersion(RETRIEVAL_DEFAULTS.weaviateCollection, resolveSchemaVersion({ ragSettings: localRagSettings }))}</span>
                        {" (schema version "}{resolveSchemaVersion({ ragSettings: localRagSettings })}{")"}
                      </p>
                      <p className="text-[9px] font-sans text-neutrals-medium leading-relaxed">
                        The class chat reads, ingest writes and Tidy Up drops. The schema version is decided server-side; for one release an API caller may set the <code>schemaVersion</code> flag to select the frozen v1 class.
                      </p>
                    </div>

                    <div className="flex flex-col gap-1 w-full bg-amber-500/5 border border-amber-500/10 rounded-lg p-2.5 mt-1">
                      <span className="text-[10px] font-sans font-bold text-amber-400 uppercase tracking-[0.5px]">
                        ⚠ Static token
                      </span>
                      <p className="text-[10px] font-sans text-neutrals-medium leading-relaxed mt-0.5">
                        Requests are authenticated with the static MLIS token configured in the Chat Agent panel, sent as the <code>x-auth-token</code> header. There is no SSO or session-based authentication — the token does not expire when you log out.
                      </p>
                    </div>
                  </div>

                  {/* Vector DB Connection Test Runner */}
                  <div className="flex flex-col gap-1.5 w-full border-t border-white/5 pt-3 mt-1.5">
                    <div className="flex gap-2 items-center bg-black/40 border border-white/10 rounded-lg p-2 w-full">
                      <div className="flex-1 text-[10px] text-neutrals-light font-mono truncate">
                        GET {localWeaviateUrl}/v1/meta - [Header: x-auth-token]
                      </div>
                      <button
                        type="button"
                        onClick={handleRunWeaviateTest}
                        disabled={weaviateTesting}
                        className="py-1 px-3 bg-brand-vivid hover:brightness-110 rounded text-[9px] font-sans font-bold uppercase tracking-[0.5px] text-white transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        {weaviateTesting ? (
                          <RiLoader4Line size={12} className="animate-spin" />
                        ) : (
                          <>
                            <RiPlayLine size={12} />
                            Run Test
                          </>
                        )}
                      </button>
                    </div>
                    <div className="mt-1.5 p-3 rounded-lg border border-white/5 bg-black/60 text-[11px] font-mono leading-relaxed h-24 overflow-y-auto custom-scrollbar text-neutrals-light whitespace-pre-wrap">
                      {weaviateTestResponse}
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>

          {/* Full Width Bottom Section: Persona Settings (Stays visible across all tabs) */}
          <div className="px-6 py-4 border-t border-white/10 bg-[#1e1e1e]/40 flex flex-col gap-4" onClick={() => setOpenTooltip(null)}>
            <div className="flex justify-between items-center border-b border-white/5 pb-2">
              <h3 className="text-white text-[11px] md:text-xs font-sans font-bold uppercase tracking-[1.2px]">
                Global Persona & Parameter Settings
              </h3>
              
              {/* Temperature & Max Tokens inputs */}
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2 relative">
                  <span className="text-[9px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-0.5 relative">
                    Temp
                    <span className="flex items-center shrink-0 cursor-pointer text-neutrals-medium hover:text-white select-none" onClick={(e) => { e.stopPropagation(); setOpenTooltip(openTooltip === "temp" ? null : "temp"); }}>
                      <RiInformationLine size={11} />
                    </span>
                    {openTooltip === "temp" && (
                      <span className="absolute bottom-7 left-0 z-50 bg-[#121212] border border-white/15 rounded-xl p-3 text-[12px] md:text-[13px] text-white normal-case font-normal tracking-normal leading-relaxed w-72 md:w-80 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        Controls LLM response creativity/randomness. Lower values (e.g. 0.1) ensure precise, deterministic code outputs, while higher values allow more variation.
                      </span>
                    )}
                    :
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.1"
                    value={localTemperature}
                    onChange={(e) => setLocalTemperature(parseFloat(e.target.value))}
                    className="w-20 accent-brand-vivid cursor-pointer"
                  />
                  <span className="text-[10px] font-mono text-white w-6">{localTemperature}</span>
                </div>
                <div className="flex items-center gap-2 relative">
                  <span className="text-[9px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium flex items-center gap-0.5 relative">
                    Tokens
                    <span className="flex items-center shrink-0 cursor-pointer text-neutrals-medium hover:text-white select-none" onClick={(e) => { e.stopPropagation(); setOpenTooltip(openTooltip === "tokens" ? null : "tokens"); }}>
                      <RiInformationLine size={11} />
                    </span>
                    {openTooltip === "tokens" && (
                      <span className="absolute bottom-7 right-0 z-50 bg-[#121212] border border-white/15 rounded-xl p-3 text-[12px] md:text-[13px] text-white normal-case font-normal tracking-normal leading-relaxed w-72 md:w-80 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        The maximum token generation limit (words/code segments) for a single inference response.
                      </span>
                    )}
                    :
                  </span>
                  <input
                    type="number"
                    value={localMaxTokens}
                    onChange={(e) => setLocalMaxTokens(parseInt(e.target.value))}
                    className="w-16 py-0.5 px-1.5 rounded border border-white/10 bg-black/40 text-[10px] text-white outline-none focus:border-brand-vivid font-mono text-center"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium">
                Active System Persona Prompt
              </label>
              <textarea
                rows={3}
                value={localSystemPrompt}
                onChange={(e) => setLocalSystemPrompt(e.target.value)}
                className="p-2.5 rounded-lg border border-white/10 bg-black/40 text-xs text-white outline-none focus:border-brand-vivid leading-relaxed font-sans custom-scrollbar w-full"
                required
              />
            </div>
          </div>

          {/* Footer Save Row */}
          <div className="px-6 py-4 border-t border-white/10 flex justify-between items-center bg-black/20">
            <div className="text-[10px] font-sans text-neutrals-medium">
              {hasUnsavedChanges ? (
                <span className="text-amber-400/80">⚠️ You have unsaved changes</span>
              ) : (
                <span className="text-emerald-400/80">✓ Settings synced with runtime</span>
              )}
            </div>
            <button
              type="submit"
              disabled={saving}
              className="py-3 px-8 bg-gradient-to-r from-purple-600 to-indigo-600 hover:brightness-110 rounded-xl text-[12px] font-sans font-extrabold uppercase tracking-[1.5px] text-white transition-all flex items-center gap-2 cursor-pointer shadow-xl shadow-purple-500/20 hover:shadow-purple-500/40 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            >
              {saving ? (
                <RiLoader4Line size={16} className="animate-spin" />
              ) : saveSuccess ? (
                <RiCheckLine size={16} className="text-white" />
              ) : (
                <RiSaveLine size={16} />
              )}
              {saving ? "SAVING..." : saveSuccess ? "SAVED!" : "SAVE CONFIGURATION"}
            </button>
          </div>

        </form>

        {/* D31: an embedding change re-indexes — said before anything is saved */}
        {showReindexNotice && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
            <div role="dialog" aria-modal="true" aria-labelledby="reindex-title" className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-[#141414] text-white p-6 flex flex-col gap-4 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
              <h3 id="reindex-title" className="text-sm font-sans font-bold uppercase tracking-[1.2px] text-amber-300">Re-index required</h3>
              <p className="text-xs font-sans text-neutrals-light leading-relaxed">
                Changing the embedding model to <span className="font-mono text-white">{localEmbedModelName}</span> makes the
                stored vectors unusable. Saving opens Tidy Up to clear the collection (you type its name), then the{" "}
                {indexedDocumentCount} indexed document(s) are ingested again with the new model. Document answers are
                unavailable until that finishes.
              </p>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowReindexNotice(false)} className="py-2 px-4 rounded-lg border border-white/10 text-[10px] font-sans font-bold uppercase tracking-[1px] text-neutrals-light hover:text-white">
                  Cancel
                </button>
                <button type="button" onClick={() => { setShowReindexNotice(false); handleSave(null, true); }} className="py-2 px-4 rounded-lg bg-amber-500/90 hover:bg-amber-500 text-[10px] font-sans font-bold uppercase tracking-[1px] text-black">
                  Save and re-index
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Custom Unsaved Changes Confirmation Modal */}
        {showConfirmClose && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md">
            <div className="w-full max-w-md bg-[#181818] border border-white/10 rounded-2xl p-6 shadow-2xl text-white">
              <h3 className="text-sm font-sans font-bold uppercase tracking-[1.5px] text-white mb-2">
                Unsaved Changes
              </h3>
              <p className="text-xs text-neutrals-medium font-sans leading-relaxed mb-6">
                You have modified configurations in the admin panel that have not been saved. Leaving now will discard these modifications.
              </p>
              <div className="flex justify-end gap-3 font-sans text-[10px] font-bold uppercase tracking-[0.5px]">
                <button
                  type="button"
                  onClick={() => setShowConfirmClose(false)}
                  className="px-4 py-2 rounded-lg border border-white/10 bg-transparent text-neutrals-light hover:bg-white/5 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowConfirmClose(false);
                    onClose(); // Discard and close
                  }}
                  className="px-4 py-2 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-all cursor-pointer"
                >
                  Discard & Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowConfirmClose(false);
                    // D31: an embedding change needs the re-index notice first, so the drawer stays open for it.
                    if (localEmbedModelName !== embedModelName || localEmbedEndpointUrl !== embedEndpointUrl) {
                      setShowReindexNotice(true);
                      return;
                    }
                    handleSave(); // Save changes
                    setTimeout(() => {
                      onClose(); // Close after save complete
                    }, 900);
                  }}
                  className="px-4 py-2 rounded-lg bg-brand-vivid text-white hover:brightness-110 transition-all cursor-pointer"
                >
                  Save & Close
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </motion.div>
  );
}
