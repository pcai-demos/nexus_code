# nexcode credentials — where they live and how to rotate them (T23)

Since T23 (2026-09-08, `inputs/rag-audit/t23-design.md`) **no credential is
in source**. The platform's tokens live in one Kubernetes Secret,
`nexcode-credentials` in `nexus-nexcode`, which the chart references by
name and never renders. The pod reads them as runtime env, in server code
only (`src/lib/credentials.js`); a value never reaches an image, the
browser, Tilt, or git.

| Secret key | env var | bound to (`helm/values.yaml` → `credentials.endpoints`) |
|---|---|---|
| `chatToken` | `NEXCODE_CHAT_TOKEN` | the MLIS chat deployment (the code agent uses it too) |
| `embedToken` | `NEXCODE_EMBED_TOKEN` | the MLIS embedder (the Ollama default needs none) |
| `rerankToken` | `NEXCODE_RERANK_TOKEN` | the MLIS reranker |
| `litellmToken` | `NEXCODE_LITELLM_TOKEN` | the LiteLLM gateway (optional; a future enhancement) |
| `weaviateToken` | `NEXCODE_WEAVIATE_TOKEN` | the vector store — an OVERRIDE only; by default the pod's own service-account token is used (design D3) |

**One token per endpoint.** Each MLIS deployment authorises its own
service account; a shared token is a silent 403 on the others (F-22).

## Rotation (the platform owner's action)

1. Issue new service accounts / tokens for the three MLIS endpoints (and a
   new LiteLLM key if that gateway is in use).
2. Write them into `inputs/tokens/nexcode-credentials.env` (gitignored):
   ```
   chatToken=<value>
   embedToken=<value>
   rerankToken=<value>
   litellmToken=<value>      # optional
   ```
3. `sh scripts/secrets/apply-credentials.sh` — applies the Secret; prints
   the key NAMES it wrote and nothing else.
4. Roll the pod: bump `rollStamp` in `helm/values.yaml`, `touch Tiltfile`.
   **Never `tilt down`** (it deletes the Helm release; the ledger volume
   came back empty once — F-87). A running container does not see a
   changed Secret.
5. Verify: `sh tests/eval/baselines/t22-artifacts/verify_pod.sh`, then
   `GET /api/health` → `credentials` reads `env` for chat / embed / rerank
   and `workload` for weaviate; `sh tests/eval/baselines/t23-artifacts/run_pod_gates.sh`
   in the pod (the gates read the same env).
6. Revoke the old service accounts at the platform. From that moment every
   value in git history is dead.

Weaviate needs no rotation: the kubelet refreshes the pod's projected
service-account token on its own.

## What the app does with a blank field

The admin drawer's token fields are empty by default and user-owned: a key
typed there is sent for that request (and wins over the server's). A blank
field means "use the server's credential" — but only when the request's
endpoint URL is one of the bound origins above; a platform token is never
sent to any other host. Every chat / retrieve / ingest response says which
source served each hop (`credentialSources`: `request` / `env` /
`workload` / `none`), and the drawer shows the server's presence beside
each field.
