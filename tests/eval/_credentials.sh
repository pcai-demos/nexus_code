# T23 (secrets out of source, design D9) — the harness's ONE credential source.
# Sourced (`. tests/eval/_credentials.sh`) by every runner that still runs,
# in-pod, where `kubectl exec` inherits the container's env: the Secret's
# NEXCODE_*_TOKEN entries and the kubelet's projected service-account token.
# Before T23 every runner regexed the tokens out of page.js; the page carries
# none now. There is deliberately NO fallback to the page: a missing Secret is
# a failed gate, not a quiet substitution. Never prints a value.
#
# Exports (the names the runners and tests/eval/run.js already read):
#   RAG_EVAL_TOKEN            the store credential (also sent as `token` — the
#                             Ollama embedder ignores it, as it ignored the JWT)
#   RAG_EVAL_WEAVIATE_TOKEN   the same: NEXCODE_WEAVIATE_TOKEN if set, else the
#                             pod's own projected token (design D3, measured 200)
#   RAG_EVAL_RERANK_TOKEN     NEXCODE_RERANK_TOKEN (the reranker's own — F-22)
#   RAG_EVAL_EMBED_ALT_TOKEN  NEXCODE_EMBED_TOKEN (I-PIN's MLIS embedder)
# NEXCODE_CHAT_TOKEN is left where it is: the gates chat through Ollama.
_t23_fail() { echo "GATE FAILED: $1"; exit 1; }
_T23_WORKLOAD_FILE="${NEXCODE_WORKLOAD_TOKEN_FILE:-/var/run/secrets/kubernetes.io/serviceaccount/token}"
if [ -n "${NEXCODE_WEAVIATE_TOKEN:-}" ]; then
  RAG_EVAL_WEAVIATE_TOKEN="$NEXCODE_WEAVIATE_TOKEN"; _T23_STORE_SOURCE=env
elif [ -r "$_T23_WORKLOAD_FILE" ]; then
  RAG_EVAL_WEAVIATE_TOKEN=$(cat "$_T23_WORKLOAD_FILE"); _T23_STORE_SOURCE=workload
else
  _t23_fail "no store credential — NEXCODE_WEAVIATE_TOKEN is unset and $_T23_WORKLOAD_FILE is not readable (T23 design D3)"
fi
[ -n "$RAG_EVAL_WEAVIATE_TOKEN" ] || _t23_fail "the store credential is empty (T23 design D3)"
[ -n "${NEXCODE_RERANK_TOKEN:-}" ] || _t23_fail "NEXCODE_RERANK_TOKEN is not set in this environment — the nexcode-credentials Secret is missing, or this pod predates T23 (design D9)"
[ -n "${NEXCODE_EMBED_TOKEN:-}" ] || _t23_fail "NEXCODE_EMBED_TOKEN is not set in this environment — I-PIN cases 1 and 6 need the MLIS embedder (design D9)"
RAG_EVAL_TOKEN="$RAG_EVAL_WEAVIATE_TOKEN"
RAG_EVAL_RERANK_TOKEN="$NEXCODE_RERANK_TOKEN"
RAG_EVAL_EMBED_ALT_TOKEN="$NEXCODE_EMBED_TOKEN"
export RAG_EVAL_TOKEN RAG_EVAL_WEAVIATE_TOKEN RAG_EVAL_RERANK_TOKEN RAG_EVAL_EMBED_ALT_TOKEN
echo "--- credentials (T23): store=$_T23_STORE_SOURCE rerank=env embed=env (names only)"
