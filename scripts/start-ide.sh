#!/bin/bash
# ============================================================================
# NexCODE IDE — Start code-server container
# ============================================================================
# Launches a code-server (VS Code in browser) container on Rancher Desktop
# with persistent volumes for workspace, code-server data, and shared data.
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

CONTAINER_NAME="nexcode-ide"
HOST_PORT=8443
CONTAINER_PORT=8080
# Colours for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Colour

echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       NexCODE IDE — Starting...          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"

# Create persistent directories if they don't exist
echo -e "${YELLOW}▸ Ensuring persistent directories exist...${NC}"
mkdir -p "${PROJECT_ROOT}/nexcode-data/workspace"
mkdir -p "${PROJECT_ROOT}/nexcode-data/code-server-data"
mkdir -p "${PROJECT_ROOT}/nexcode-data/shared/uploads"
mkdir -p "${PROJECT_ROOT}/nexcode-data/shared/generated"
mkdir -p "${PROJECT_ROOT}/nexcode-data/shared/analysis"

IMAGE_NAME="nexcode-ide-custom"
IMAGE="${IMAGE_NAME}:latest"

# Build the custom IDE image if it does not exist
if ! docker images --format '{{.Repository}}' | grep -q "^${IMAGE_NAME}$"; then
  echo -e "${YELLOW}▸ Custom IDE image '${IMAGE_NAME}' not found. Building it (this may take 1-2 minutes)...${NC}"
  docker build -f "${PROJECT_ROOT}/Dockerfile.ide" -t "${IMAGE_NAME}:latest" "${PROJECT_ROOT}"
  echo -e "${GREEN}✓ Custom IDE image built successfully!${NC}"
fi

# Stop and remove existing container if running
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo -e "${YELLOW}▸ Removing existing container '${CONTAINER_NAME}'...${NC}"
  docker stop "${CONTAINER_NAME}" 2>/dev/null || true
  docker rm "${CONTAINER_NAME}" 2>/dev/null || true
fi

# Launch the container
# - code-server-data: entire .local/share/code-server dir (extensions, settings, logs, etc.)
# - workspace: the empty sandbox project folder
# - shared: cross-app data exchange directory (visible as .shared/ in the IDE)
# - nexcode-theme: read-only mount for the NexCODE VS Code theme extension
echo -e "${YELLOW}▸ Launching code-server container...${NC}"
docker run -d \
  --name "${CONTAINER_NAME}" \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  -p 127.0.0.1:9100:9100 \
  -e "LANG=en_GB.UTF-8" \
  -e "LC_ALL=en_GB.UTF-8" \
  -e "NODE_TLS_REJECT_UNAUTHORIZED=0" \
  -v "${PROJECT_ROOT}/nexcode-data/workspace:/home/coder/project" \
  -v "${PROJECT_ROOT}/nexcode-data/code-server-data:/home/coder/.local/share/code-server" \
  -v "${PROJECT_ROOT}/nexcode-data/shared:/home/coder/project/.shared" \
  -v "${PROJECT_ROOT}/code-server-theme:/home/coder/nexcode-theme:ro" \
  -v "${PROJECT_ROOT}/code-server-ext/nexcode-bridge:/home/coder/nexcode-bridge:ro" \
  "${IMAGE}" \
  --auth none \
  --bind-addr "0.0.0.0:${CONTAINER_PORT}" \
  --disable-telemetry \
  --disable-workspace-trust \
  --disable-getting-started-override \
  --locale en-GB

# Install NexCODE theme extension (copy directly into extensions dir)
echo -e "${YELLOW}▸ Installing NexCODE Dark theme...${NC}"
sleep 2  # Give code-server a moment to initialise
THEME_EXT_DIR="/home/coder/.local/share/code-server/extensions/nexcode.nexcode-theme-1.0.0"
docker exec "${CONTAINER_NAME}" mkdir -p "${THEME_EXT_DIR}" 2>/dev/null
docker exec "${CONTAINER_NAME}" cp -r /home/coder/nexcode-theme/. "${THEME_EXT_DIR}/" 2>/dev/null && \
  echo -e "${GREEN}  ✓ NexCODE Dark theme installed${NC}" || \
  echo -e "${YELLOW}  Theme install skipped (may already be installed)${NC}"

# Install Code Runner extension for one-click file execution
echo -e "${YELLOW}▸ Installing Code Runner extension...${NC}"
docker exec "${CONTAINER_NAME}" code-server --install-extension formulahendry.code-runner 2>/dev/null && \
  echo -e "${GREEN}  ✓ Code Runner extension installed${NC}" || \
  echo -e "${YELLOW}  Code Runner install skipped${NC}"

# Install NexCODE Bridge extension (IDE ↔ Chat bidirectional communication)
echo -e "${YELLOW}▸ Installing NexCODE Bridge extension...${NC}"
BRIDGE_EXT_DIR="/home/coder/.local/share/code-server/extensions/nexcode.nexcode-bridge-1.0.0"
docker exec "${CONTAINER_NAME}" mkdir -p "${BRIDGE_EXT_DIR}" 2>/dev/null
docker exec "${CONTAINER_NAME}" cp -r /home/coder/nexcode-bridge/. "${BRIDGE_EXT_DIR}/" 2>/dev/null && \
  echo -e "${GREEN}  ✓ NexCODE Bridge extension installed${NC}" || \
  echo -e "${YELLOW}  Bridge extension install skipped${NC}"

# Seed default VS Code settings if not already configured
SETTINGS_DIR="${PROJECT_ROOT}/nexcode-data/code-server-data/User"
SETTINGS_FILE="${SETTINGS_DIR}/settings.json"
if [ ! -f "${SETTINGS_FILE}" ]; then
  echo -e "${YELLOW}▸ Seeding default VS Code settings...${NC}"
  mkdir -p "${SETTINGS_DIR}"
  cat > "${SETTINGS_FILE}" << 'SETTINGS'
{
  "workbench.colorTheme": "NexCODE Dark",
  "editor.fontFamily": "'Poppins', 'Fira Code', 'Cascadia Code', monospace",
  "editor.fontSize": 14,
  "editor.lineHeight": 1.6,
  "editor.minimap.enabled": false,
  "editor.bracketPairColorization.enabled": true,
  "editor.guides.bracketPairs": true,
  "editor.smoothScrolling": true,
  "editor.cursorBlinking": "smooth",
  "editor.cursorSmoothCaretAnimation": "on",
  "workbench.iconTheme": null,
  "window.menuBarVisibility": "compact",
  "terminal.integrated.fontFamily": "'Fira Code', monospace",
  "terminal.integrated.fontSize": 13,
  "workbench.startupEditor": "none",
  "security.workspace.trust.enabled": false,
  "keyboard.dispatch": "keyCode",
  "code-runner.runInTerminal": true,
  "code-runner.saveFileBeforeRun": true,
  "code-runner.clearPreviousOutput": true,
  "code-runner.showExecutionMessage": false,
  "code-runner.executorMap": {
    "cobol": "cd $dir && cobc -x $fileName -o $fileNameWithoutExt && ./$fileNameWithoutExt",
    "pascal": "cd $dir && fpc $fileName -o$fileNameWithoutExt && ./$fileNameWithoutExt",
    "fortran": "cd $dir && gfortran $fileName -o $fileNameWithoutExt && ./$fileNameWithoutExt",
    "java": "cd $dir && javac -cp .:/usr/share/java/junit-platform-console-standalone.jar $fileName && (grep -q \"@Test\" $fileName && java -jar /usr/share/java/junit-platform-console-standalone.jar -cp . --select-class $fileNameWithoutExt || java -cp . $fileNameWithoutExt)"
  }
}
SETTINGS
fi

# Wait for container to be healthy
echo -e "${YELLOW}▸ Waiting for code-server to start...${NC}"
for i in {1..20}; do
  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${HOST_PORT}/" | grep -q "200\|302"; then
    echo ""
    echo -e "${GREEN}✓ code-server is running!${NC}"
    echo ""
    echo -e "  Direct access:  ${GREEN}http://localhost:${HOST_PORT}${NC}"
    echo -e "  Via NexCODE:    ${GREEN}http://localhost:3000/ide/${NC}"
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║       NexCODE IDE — Ready!               ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
    exit 0
  fi
  printf "."
  sleep 1
done

echo ""
echo -e "${RED}✗ code-server did not start within 20 seconds.${NC}"
echo -e "${RED}  Check logs with: docker logs ${CONTAINER_NAME}${NC}"
exit 1
