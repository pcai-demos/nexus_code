# Chart notes: nexcode

## Summary

| | |
|---|---|
| Chart / release | `nexcode` v0.1.0 (image `dev/nexcode:tilt-0d62d9641ebbbd56 + dev/nexcode-ide:tilt-266ccacf21f27e93`) |
| Source | Scaffolded with `nexus-helm-chart`; values taken from the live deployment on 2026-10-29 |
| App repo | `pcai-demos/nexus_code` |
| Namespace | `nexus` |
| Host | `nexcode.${DOMAIN_NAME}` (lonpcai: `https://nexcode.demo.lon-pcai.twlon.com`, unchanged) |
| Packaged | `charts/nexcode-0.1.0.tgz` (`check.sh --package`) |
| Date | 2026-10-29 |

## Decisions

| Topic | Value | Why |
|---|---|---|
| Port and probe | 3000 (IDE 8080/9100 inside the pod); `/ (IDE: / on 8080)` | As the live deployment |
| Sign-in | `nexusSso.enabled: false`, PCAI AuthorizationPolicy off | Nexus gateway not live yet; turned on per app in the SSO phase |
| Data | `existingClaim: nexcode-workspace` (nexus-nfs-retain, 5Gi): subPaths `code-workspace`, `app-state`, `app-images`, `code-server-data`, mounted exactly as live. Data copied from PV `pvc-59db1b1f…` (already Retain) at the cut-over. | Survives uninstall and re-import |
| Secrets | `nexcode-secrets`: `NEXCODE_BRIDGE_TOKEN` (was a literal in the Deployment), `NEXCODE_CHAT_TOKEN`, `NEXCODE_EMBED_TOKEN`, `NEXCODE_LITELLM_TOKEN`, `NEXCODE_RERANK_TOKEN` (were keys `chatToken`… of `nexcode-credentials`). Copied without printing at the cut-over. | Never in values (EzAppConfig stores values in plain text) |
| Security context | root (dev image) for the app; code-server as uid 1000, fsGroup 1000 | Matches the live image; least privilege otherwise (no privilege escalation, no service-account token unless needed) |
| NetworkPolicy | defaults (namespace `nexus` + platform ingress gateway) | Nexus-scoped isolation |
| Resources | see `values.yaml` | From live limits and `kubectl top` |
| Plain env | Model/service URLs (plain). | |

Other notes: Not in the repo before (it had no chart or Tiltfile on `main`). code-server runs as a sidecar (`extraContainers`, uid 1000); its start script is a ConfigMap, byte-identical to the live command. `NODE_TLS_REJECT_UNAUTHORIZED=0` kept: the app calls PCAI endpoints with the platform's self-signed certificates.

## Import Framework labels

`hpe-ezua/app: nexcode` and `hpe-ezua/type: vendor-service` are set natively by `_helpers.tpl` on
every Pod, Deployment and Service. No Kyverno policy: a namespace-wide label policy rewrites other
releases' pods in the shared `nexus` namespace.

## Verification

`check.sh` (2026-10-29):

```
  ok    helm lint
  rendered: ConfigMap/nexcode-ide-start Deployment/nexcode NetworkPolicy/nexcode Service/nexcode ServiceAccount/nexcode VirtualService/nexcode
  ok    no Kyverno policy
  ok    hpe-ezua labels on workloads, pod templates and Services
  ok    selectors scoped to the release
  ok    images pinned: registry.demo.lon-pcai.twlon.com/dev/nexcode-ide:tilt-266ccacf21f27e93 registry.demo.lon-pcai.twlon.com/dev/nexcode:tilt-0d62d9641ebbbd56
  ok    no Secrets in the chart
  ok    no secret-looking literals in values.env
  ok    VirtualService nexcode.${DOMAIN_NAME} -> nexcode.nexus.svc.cluster.local
  ok    with nexusSso.enabled the host goes to nexus-gateway.nexus.svc.cluster.local
  ok    AuthorizationPolicy renders when enabled (off by default)
```

Server-side dry run in `nexus` on lonpcai: all objects accepted.
Not deployed yet. Switch: Recreate strategy (ReadWriteOnce volume): a few minutes' downtime at the switch.

## Deploying

**Helm (direct):**

```bash
helm upgrade --install nexcode charts/nexcode -n nexus --kube-context lonpcai \
  --set-string ezua.domainName=demo.lon-pcai.twlon.com \
  --set ezua.virtualService.endpoint=nexcode.demo.lon-pcai.twlon.com
```

**PCAI Import Framework:**

1. Open AI Essentials, then **Tools & Frameworks**, then **Import Framework**.
2. Upload `charts/nexcode-0.1.0.tgz`.
3. Set the namespace to `nexus` and the release name to `nexcode`.
4. Keep `${DOMAIN_NAME}` in the values.

A release with the same name must not already exist in `nexus`.

## Phase 3b update (2026-10-29)

- **Clean name:** release, chart and objects are `nexcode` (was `nexus-nexcode`, or the old app name).
  Secrets and claims follow it: `nexcode-secrets`, `nexcode-data`/`-workspace`.
- **Image:** `registry.demo.lon-pcai.twlon.com/dev/nexcode:tilt-0d62d9641ebbbd56`. Already a production build; unchanged.
- **Production settings:** no `NODE_ENV=development`, `ALLOWED_DEV_ORIGINS` or
  `NODE_TLS_REJECT_UNAUTHORIZED=0`. Node trusts the PCAI CA through `NODE_EXTRA_CA_CERTS`
  (the platform mounts it in every pod).
- **LiteLLM:** `NEXCODE_LITELLM_TOKEN` is the shared `nexus-app-key`. The UI's default provider
  is hard-coded to Ollama (`endpointType || "ollama"` in `src/app/page.js`); making LiteLLM the
  default is a code change in this repo.
