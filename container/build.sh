#!/bin/bash
# Build the NanoCrab agent container image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="nanocrab-agent"
TAG="${1:-latest}"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"

echo "Building NanoCrab agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"

${CONTAINER_RUNTIME} build -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | timeout 45 ${CONTAINER_RUNTIME} run -i --rm ${IMAGE_NAME}:${TAG}"
echo ""
echo "Note: the Claude runner stays open after the first result waiting for NanoCrab IPC follow-up messages."
echo "A one-off smoke is healthy when it emits ---NANOCRAB_OUTPUT_START--- / ---NANOCRAB_OUTPUT_END--- markers."
