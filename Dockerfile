# T22 (runtime hardening, design D1 / D2): three stages, one image.
#
#   base  the runtime's dependencies, PINNED — Node 20.20.2 (the version every
#         measurement in the audit was made on; F-91 records three packages
#         that would prefer 22), the apt libraries docling needs, and the
#         Python stack from requirements.txt + constraints.txt (the deployed
#         image's exact 119-package freeze, captured 2026-09-07 —
#         tests/eval/baselines/t22-artifacts/pod-pip-freeze-*.txt — so a
#         rebuild reproduces today's parser, FM-N6). `npm ci` from the lockfile.
#   prod  `next build` at IMAGE BUILD time and `next start` at run time. The
#         default target (Tiltfile). IDE_HOST is set BEFORE the build because
#         Next compiles next.config.mjs's rewrites into .next/routes-manifest.json
#         (measured: inputs/rag-audit/t22-design.md §0 item 10) — the value must
#         equal the chart's `ide.port` (helm/values.yaml). build-info.json is
#         written here and served by GET /api/health (design D5).
#   dev   `next dev` with Tilt's live sync, for hot-reload work on the UI:
#         `tilt up -- --dev`. Its memory grows with uptime (F-65) — it is not
#         the demo's runtime any more.
#
# .dockerignore keeps the macOS .venv (F-6), .claude/ and inputs/ out of the
# context; tests/ deliberately ships (the in-pod gates run from it).

FROM node:20.20.2-slim AS base
WORKDIR /usr/src/app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    libxcb1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# The parser stack, pinned to the deployed image's freeze (design D2).
COPY requirements.txt constraints.txt ./
RUN python3 -m pip install --no-cache-dir --break-system-packages -r requirements.txt -c constraints.txt

COPY package*.json ./
RUN npm ci

COPY . .
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# ── dev: the hot-reload loop (tilt up -- --dev) ─────────────────────────────
FROM base AS dev
CMD ["npm", "run", "dev"]

# ── prod: the compiled server (the default) ─────────────────────────────────
FROM base AS prod
ARG GIT_SHA=unknown
ARG GIT_DIRTY=unknown
# Compiled into the rewrites at build time — keep equal to helm/values.yaml ide.port.
ENV IDE_HOST=localhost:8080
ENV NODE_ENV=production
RUN npm run build \
    && GIT_SHA=$GIT_SHA GIT_DIRTY=$GIT_DIRTY node scripts/write-build-info.js
CMD ["npm", "run", "start"]
