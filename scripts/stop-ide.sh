#!/bin/bash
# ============================================================================
# NexCODE IDE — Stop code-server container
# ============================================================================

CONTAINER_NAME="nexcode-ide"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}▸ Stopping NexCODE IDE container...${NC}"

if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  docker stop "${CONTAINER_NAME}" 2>/dev/null || true
  docker rm "${CONTAINER_NAME}" 2>/dev/null || true
  echo -e "${GREEN}✓ Container '${CONTAINER_NAME}' stopped and removed.${NC}"
  echo -e "${GREEN}  Your workspace, extensions, and shared data are safe in nexcode-data/.${NC}"
else
  echo -e "${YELLOW}  Container '${CONTAINER_NAME}' is not running.${NC}"
fi
