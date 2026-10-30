#!/bin/sh
# T23 (secrets out of source, design D1 / D13) — write the `nexcode-credentials`
# Secret from a GITIGNORED env file. The chart references the Secret by name
# (helm/values.yaml `credentials.secretName`) and never renders it, so this is
# the only place the values pass through — in memory, piped straight into
# `kubectl apply`, never on a command line, never echoed, never in a file the
# repository tracks.
#
#   sh scripts/secrets/apply-credentials.sh [inputs/tokens/nexcode-credentials.env]
#
# The file holds KEY=value lines (a `#` line is a comment):
#   chatToken=…       the MLIS chat deployment's service-account token (the code agent too)
#   embedToken=…      the MLIS embedder's
#   rerankToken=…     the MLIS reranker's
#   litellmToken=…    the LiteLLM gateway key (optional — a future enhancement)
#   weaviateToken=…   optional override; by default the pod's own service-account token serves the store (design D3)
# chatToken, embedToken and rerankToken are required. After applying, ROLL the
# pod (bump `rollStamp` in helm/values.yaml + `touch Tiltfile`; never `tilt
# down`): a running container does not see a changed Secret. Then
# `sh tests/eval/baselines/t22-artifacts/verify_pod.sh` and check
# GET /api/health → `credentials` (names only). See README.md here for the
# rotation runbook.
set -eu
FILE="${1:-inputs/tokens/nexcode-credentials.env}"
NS="${NEXCODE_NAMESPACE:-nexus-nexcode}"
NAME="${NEXCODE_SECRET_NAME:-nexcode-credentials}"
[ -r "$FILE" ] || { echo "apply-credentials: no readable file at $FILE (KEY=value lines: chatToken, embedToken, rerankToken, litellmToken, weaviateToken)" >&2; exit 1; }
command -v kubectl >/dev/null || { echo "apply-credentials: kubectl not found" >&2; exit 1; }
command -v node >/dev/null || { echo "apply-credentials: node not found" >&2; exit 1; }
# The manifest is built in memory by node (base64 per value) and piped to
# kubectl; the values never appear in a process argument or in this shell.
node - "$FILE" "$NS" "$NAME" <<'JS' | kubectl apply -f -
const fs = require("fs");
const [file, ns, name] = process.argv.slice(2);
const allowed = ["chatToken", "embedToken", "rerankToken", "litellmToken", "weaviateToken"];
const required = ["chatToken", "embedToken", "rerankToken"];
const data = {};
const lines = fs.readFileSync(file, "utf8").split("\n");
lines.forEach((raw, i) => {
  const line = raw.trim();
  if (!line || line.startsWith("#")) return;
  const eq = line.indexOf("=");
  if (eq < 0) { process.stderr.write(`apply-credentials: line ${i + 1} has no '=' — skipped\n`); return; }
  const key = line.slice(0, eq).trim();
  let value = line.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  if (!allowed.includes(key)) { process.stderr.write(`apply-credentials: unknown key '${key}' (allowed: ${allowed.join(", ")})\n`); process.exit(1); }
  if (value) data[key] = Buffer.from(value, "utf8").toString("base64");
});
for (const k of required) if (!data[k]) { process.stderr.write(`apply-credentials: ${k} is missing or empty in ${file}\n`); process.exit(1); }
process.stderr.write(`apply-credentials: applying Secret ${ns}/${name} with keys: ${Object.keys(data).join(", ")}\n`);
process.stdout.write(JSON.stringify({
  apiVersion: "v1",
  kind: "Secret",
  metadata: { name, namespace: ns, labels: { "app.kubernetes.io/part-of": "nexcode", "nexcode/managed-by": "apply-credentials.sh" } },
  type: "Opaque",
  data,
}));
JS
echo "apply-credentials: done — now roll the pod (rollStamp + touch Tiltfile) and check GET /api/health credentials"
