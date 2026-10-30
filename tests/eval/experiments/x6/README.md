# X6 — model residency vs. ingest determinism

Run 2026-08-13 against the deployed image (pod `nexcode-7f7d5d98bb-tnhf8`).

**Protocol:** `inputs/rag-audit/evaluation-plan.md` §6, "X6 — detailed protocol".
**Result:** `inputs/rag-audit/followups.md` F-17. **Verdict: H-NULL** — FM-N2
reproduces and its cause is VLM caption sampling, not model scheduling.
**T24 is confirmed correctly scoped.**

| run | Ikea captions | chunks | evictions | expiries | queries failed |
|---|---|---|---|---|---|
| 1 | 36 / 40 | 80 | 0 | 0 | 0 / 32 |
| 2 | 36 / 40 | 80 | 0 | 0 | 0 / 30 |
| 3 | 35 / 40 | 79 | 0 | 0 | 0 / 33 |

486 residency polls, all showing exactly 3 resident models, zero transitions.
Zero `[VLM Captioner Error/Exception]` lines in the pod logs across the window.

## Files

- `report.json` — verdict, decision rule outcome, config, exclusion detail
- `runs.json` — per-run chunk counts, docling traces, residency events, contamination checks
- `timeline.jsonl` — raw 2 s residency samples and query events for all three runs

## Reproducing

`scripts/experiments/x6_ollama_residency.js`. Must run **inside the pod** (needs
in-cluster DNS for Ollama/Weaviate and `localhost:3000`), and must be **detached** —
a dropped `kubectl exec` kills the driver while leaving its server-side ingest
running, which contaminates the next run (see F-18).

```sh
POD=$(kubectl get pods -n nexus-nexcode -o name | head -1 | cut -d/ -f2)
kubectl cp scripts/experiments/x6_ollama_residency.js nexus-nexcode/$POD:/tmp/x6.js -c nexcode
kubectl exec -n nexus-nexcode $POD -c nexcode -- sh -c '
  cd /usr/src/app
  export X6_TOKEN=<weaviate token — read in-pod, never printed>
  export X6_RUNS=3 X6_CONCURRENT=1 X6_QUERY_BACKEND=ollama X6_OUT=/tmp/x6
  nohup setsid node /tmp/x6.js > /tmp/x6.log 2>&1 &'
```

Capture pod logs alongside the run — `[VLM Captioner Error…]` / `[VLM Captioner
Exception…]` are the only reliable caption-failure signal. The docling trace's
shortfall conflates failures with genuine `[DECORATIVE_ELEMENT]` replies.

Collections are `RAGEval_x6_<stamp>_r<N>`, dropped on completion. Set
`X6_KEEP_COLLECTIONS=1` to retain them. The guard refuses any name outside
`/^RAGEval_[A-Za-z0-9_]+$/`, so `RAGChunk` can never be targeted.
